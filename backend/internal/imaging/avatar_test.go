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

// Cropped here and not only in the browser, so every stored picture is square —
// including one written by a client that skipped the browser path entirely.
func TestNormalizeCropsToACenteredSquare(t *testing.T) {
	// Both source formats, because they take different branches: a JPEG reports
	// itself opaque and is drawn straight across, a PNG may not be and is
	// composited onto white. JPEG is also the only format the browser ever
	// uploads, so leaving it out left the best-traveled path untested.
	fixtures := map[string]func(width, height int) []byte{
		"png": func(width, height int) []byte {
			return testutil.SolidPNG(t, width, height, testutil.Opaque)
		},
		"jpeg": func(width, height int) []byte { return testutil.SolidJPEG(t, width, height) },
	}

	for name, fixture := range fixtures {
		for _, size := range [][2]int{{1000, 500}, {60, 240}, {33, 33}} {
			out, _, err := imaging.Normalize(fixture(size[0], size[1]))
			if err != nil {
				t.Fatalf("Normalize(%s %dx%d): %v", name, size[0], size[1], err)
			}

			cfg, _, err := image.DecodeConfig(bytes.NewReader(out))
			if err != nil {
				t.Fatalf("decode result: %v", err)
			}
			want := min(size[0], size[1])
			if cfg.Width != want || cfg.Height != want {
				t.Errorf("Normalize(%s %dx%d) = %dx%d, want %dx%d",
					name, size[0], size[1], cfg.Width, cfg.Height, want, want)
			}
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

// A transparent PNG has to be composited onto something, because JPEG has no
// alpha channel. Encoded as-is, every clear pixel comes out black and a logo on
// a transparent background arrives as a dark square.
func TestNormalizeFlattensTransparencyOntoWhite(t *testing.T) {
	transparent := testutil.SolidPNG(t, 8, 8, color.NRGBA{})

	out, _, err := imaging.Normalize(transparent)
	if err != nil {
		t.Fatalf("Normalize: %v", err)
	}

	decoded, err := jpeg.Decode(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("decode result: %v", err)
	}
	r, g, b, a := decoded.At(4, 4).RGBA()
	if r < 0xf000 || g < 0xf000 || b < 0xf000 || a != 0xffff {
		t.Errorf("transparent pixel became (%d, %d, %d, %d), want opaque white", r, g, b, a)
	}
}

func TestNormalizeRefusals(t *testing.T) {
	tests := []struct {
		name string
		// Built inside the subtest, because two of these fixtures are encoded
		// and want a *testing.T that can fail the case they belong to.
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
			// GIF is not registered: the browser re-encodes to JPEG before
			// uploading, so the decoder list is about what hostile input may be
			// rather than about what a file picker allows.
			name: "a format no decoder is registered for",
			data: func(testing.TB) []byte { return []byte("GIF89a\x01\x00\x01\x00\x00\x00\x00;") },
			want: imaging.ErrUnsupported,
		},
		{
			name: "wider than the limit",
			data: func(t testing.TB) []byte {
				return testutil.SolidPNG(t, imaging.MaxDimension+1, 4, testutil.Opaque)
			},
			want: imaging.ErrTooLarge,
		},
		{
			name: "taller than the limit",
			data: func(t testing.TB) []byte {
				return testutil.SolidPNG(t, 4, imaging.MaxDimension+1, testutil.Opaque)
			},
			want: imaging.ErrTooLarge,
		},
		{
			name: "more bytes than the cap",
			data: func(testing.TB) []byte { return make([]byte, imaging.MaxBytes+1) },
			want: imaging.ErrTooLarge,
		},
		{
			// The size is refused before anything decodes it, which is the whole
			// reason the header is read separately: these dimensions describe a
			// 1.6 GB bitmap, and the input asserting them is 33 bytes long.
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
