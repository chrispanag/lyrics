package imaging_test

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"testing"

	"github.com/christos/lyrics/backend/internal/imaging"
	"github.com/christos/lyrics/backend/internal/testutil"
)

func TestNormalizeProducesJPEG(t *testing.T) {
	out, contentType, err := imaging.Normalize(testutil.SolidPNG(t, 48, 48, testutil.Opaque))
	if err != nil {
		t.Fatalf("Normalize: %v", err)
	}
	if contentType != "image/jpeg" {
		t.Errorf("content type = %q, want image/jpeg", contentType)
	}

	cfg, format, err := image.DecodeConfig(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("decode result: %v", err)
	}
	// The returned content type has to describe the returned bytes: it is what
	// gets stored, and what the GET serves the browser.
	if format != "jpeg" {
		t.Errorf("format = %q, want jpeg", format)
	}
	if cfg.Width != 48 || cfg.Height != 48 {
		t.Errorf("size = %dx%d, want 48x48", cfg.Width, cfg.Height)
	}
}

// Every stored picture is a small square, even from a client that skipped the
// browser's crop and shrink.
func TestNormalizeCropsAndShrinksToACenteredSquare(t *testing.T) {
	// Both formats: a JPEG is opaque and drawn straight across, a PNG is
	// composited onto white.
	fixtures := map[string]func(width, height int) []byte{
		"png": func(width, height int) []byte {
			return testutil.SolidPNG(t, width, height, testutil.Opaque)
		},
		"jpeg": func(width, height int) []byte { return testutil.SolidJPEG(t, width, height) },
	}

	for name, fixture := range fixtures {
		for _, size := range [][2]int{
			{1000, 500},
			{60, 240},
			{33, 33},
			// MaxDimension exactly: the shrink, not the refusal.
			{imaging.MaxDimension, imaging.MaxDimension},
		} {
			out, _, err := imaging.Normalize(fixture(size[0], size[1]))
			if err != nil {
				t.Fatalf("Normalize(%s %dx%d): %v", name, size[0], size[1], err)
			}

			cfg, _, err := image.DecodeConfig(bytes.NewReader(out))
			if err != nil {
				t.Fatalf("decode result: %v", err)
			}
			// Crop to the shorter side, then shrink to StoredEdge if larger.
			want := min(size[0], size[1], imaging.StoredEdge)
			if cfg.Width != want || cfg.Height != want {
				t.Errorf("Normalize(%s %dx%d) = %dx%d, want %dx%d",
					name, size[0], size[1], cfg.Width, cfg.Height, want, want)
			}
		}
	}
}

// Crop comes before shrink: shrinking first would squash the whole picture into
// the square. Dimensions cannot tell the two apart, so this reads pixels.
func TestNormalizeCropsBeforeShrinkingANonSquarePicture(t *testing.T) {
	// Three square bands, so the centered square is the middle band: over
	// StoredEdge (shrunk) but within MaxDimension (not refused).
	const band = imaging.MaxDimension / 3

	// Red and blue on the outside, mid-gray in the middle.
	out, _, err := imaging.Normalize(testutil.BandsPNG(t, band,
		color.NRGBA{R: 0xff, A: 0xff},
		color.NRGBA{R: 0x80, G: 0x80, B: 0x80, A: 0xff},
		color.NRGBA{B: 0xff, A: 0xff},
	))
	if err != nil {
		t.Fatalf("Normalize: %v", err)
	}

	decoded, err := jpeg.Decode(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("decode result: %v", err)
	}
	if got := decoded.Bounds(); got.Dx() != imaging.StoredEdge || got.Dy() != imaging.StoredEdge {
		t.Errorf("size = %dx%d, want %dx%d",
			got.Dx(), got.Dy(), imaging.StoredEdge, imaging.StoredEdge)
	}

	// Three points clear of the band edges. A corner crop shows an outer color
	// at the center; a squash shows red and blue near the edges.
	const mid = imaging.StoredEdge / 2
	for _, x := range []int{imaging.StoredEdge / 8, mid, imaging.StoredEdge * 7 / 8} {
		r, g, b, _ := decoded.At(x, mid).RGBA()
		if r < 0x4000 || r > 0xc000 || g < 0x4000 || g > 0xc000 || b < 0x4000 || b > 0xc000 {
			t.Errorf("(%d,%d) = (r=%d g=%d b=%d), want the middle band's mid-gray",
				x, mid, r, g, b)
		}
	}
}

// The flatten is skipped for an opaque source, so this pins that skipping it
// still draws the picture rather than leaving an empty bitmap.
func TestNormalizeKeepsAnOpaqueSourcesPixels(t *testing.T) {
	out, _, err := imaging.Normalize(testutil.SolidJPEG(t, 16, 16))
	if err != nil {
		t.Fatalf("Normalize: %v", err)
	}

	decoded, err := jpeg.Decode(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("decode result: %v", err)
	}
	// The fixture is mid-gray: white would mean the fill ran and the source was
	// never drawn over it, black that the source was drawn onto nothing.
	r, _, _, _ := decoded.At(8, 8).RGBA()
	if r < 0x4000 || r > 0xc000 {
		t.Errorf("center pixel luminance = %d, want the fixture's mid-gray", r)
	}
}

// JPEG has no alpha, so transparency must flatten onto white, not encode black.
// Both sizes: at or under StoredEdge is copied onto the fill, an oversized one
// is resampled onto it.
func TestNormalizeFlattensTransparencyOntoWhite(t *testing.T) {
	for _, edge := range []int{8, imaging.StoredEdge * 2} {
		transparent := testutil.SolidPNG(t, edge, edge, color.NRGBA{})

		out, _, err := imaging.Normalize(transparent)
		if err != nil {
			t.Fatalf("Normalize(%dx%d): %v", edge, edge, err)
		}

		decoded, err := jpeg.Decode(bytes.NewReader(out))
		if err != nil {
			t.Fatalf("decode result: %v", err)
		}
		center := decoded.Bounds().Dx() / 2
		r, g, b, a := decoded.At(center, center).RGBA()
		if r < 0xf000 || g < 0xf000 || b < 0xf000 || a != 0xffff {
			t.Errorf("transparent %dx%d pixel became (%d, %d, %d, %d), want opaque white",
				edge, edge, r, g, b, a)
		}
	}
}

func TestNormalizeRefusals(t *testing.T) {
	tests := []struct {
		name string
		// Built inside the subtest so encoded fixtures can fail their own case.
		data func(testing.TB) []byte
		want error
	}{
		{
			name: "nothing",
			data: func(testing.TB) []byte { return nil },
			want: imaging.ErrUnsupported,
		},
		{
			name: "not an image",
			data: func(testing.TB) []byte { return []byte("text pretending to be a picture") },
			want: imaging.ErrUnsupported,
		},
		{
			// No GIF decoder is registered.
			name: "a format no decoder is registered for",
			data: func(testing.TB) []byte { return []byte("GIF89a\x01\x00\x01\x00\x00\x00\x00;") },
			want: imaging.ErrUnsupported,
		},
		{
			name: "wider than the limit",
			data: func(tb testing.TB) []byte {
				tb.Helper()
				return testutil.SolidPNG(tb, imaging.MaxDimension+1, 4, testutil.Opaque)
			},
			want: imaging.ErrTooLarge,
		},
		{
			name: "taller than the limit",
			data: func(tb testing.TB) []byte {
				tb.Helper()
				return testutil.SolidPNG(tb, 4, imaging.MaxDimension+1, testutil.Opaque)
			},
			want: imaging.ErrTooLarge,
		},
		{
			name: "more bytes than the cap",
			data: func(testing.TB) []byte { return make([]byte, imaging.MaxBytes+1) },
			want: imaging.ErrTooLarge,
		},
		{
			// Refused from the header alone, before anything decodes it.
			name: "a header declaring a bomb",
			data: func(testing.TB) []byte { return testutil.PNGHeader(20000, 20000) },
			want: imaging.ErrTooLarge,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, _, err := imaging.Normalize(tt.data(t)); !errors.Is(err, tt.want) {
				t.Errorf("Normalize(%s) = %v, want %v", tt.name, err, tt.want)
			}
		})
	}
}
