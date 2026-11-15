// Package imaging normalizes an uploaded profile picture into the one form this
// application stores: a centered square, no larger than StoredEdge on a side,
// re-encoded as JPEG. Re-encoding strips EXIF (including GPS) and makes the
// stored bytes Go's encoder output; doing it here holds for every client.
package imaging

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/jpeg"

	// Superset of image/draw, needed for its resampling scaler.
	"golang.org/x/image/draw"

	// Registers the PNG decoder (JPEG's comes with image/jpeg). The list bounds
	// what hostile input may be, not what a file picker allows.
	_ "image/png"
)

const (
	// MaxBytes bounds an encoded upload; generous headroom over a browser-shrunk
	// picture.
	MaxBytes = 1 << 20

	// MaxDimension bounds each decoded side, and so the bitmap allocated. It is
	// a refusal, not the stored size (StoredEdge); anything between is shrunk.
	MaxDimension = 1024

	// StoredEdge is the edge of the stored square: larger pictures are scaled
	// down, smaller ones left alone. Mirrors AVATAR_SIZE in
	// web/src/lib/image.ts; if the two disagree, the smaller wins.
	StoredEdge = 256

	// contentTypeJPEG is returned with the bytes, not exported, so the stored
	// label cannot disagree with the encoded format.
	contentTypeJPEG = "image/jpeg"

	jpegQuality = 82
)

var (
	// ErrTooLarge means the upload was refused on size, encoded or decoded.
	ErrTooLarge = errors.New("image is too large")
	// ErrUnsupported means the bytes are not an image this package can read.
	ErrUnsupported = errors.New("unsupported image")
)

// Normalize validates an uploaded image and returns a square JPEG of it, no
// larger than StoredEdge on a side, together with the content type to store it
// under.
func Normalize(data []byte) ([]byte, string, error) {
	if len(data) == 0 {
		return nil, "", fmt.Errorf("%w: no image data", ErrUnsupported)
	}
	if len(data) > MaxBytes {
		return nil, "", fmt.Errorf("%w: %d encoded bytes", ErrTooLarge, len(data))
	}

	// Read the header before decoding: a tiny PNG can declare 20000x20000, and
	// Decode allocates the full bitmap before any later check could refuse it.
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, "", fmt.Errorf("%w: %w", ErrUnsupported, err)
	}
	if cfg.Width < 1 || cfg.Height < 1 {
		return nil, "", fmt.Errorf("%w: %s image has no pixels", ErrUnsupported, format)
	}
	if cfg.Width > MaxDimension || cfg.Height > MaxDimension {
		return nil, "", fmt.Errorf("%w: %dx%d pixels", ErrTooLarge, cfg.Width, cfg.Height)
	}

	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, "", fmt.Errorf("%w: %w", ErrUnsupported, err)
	}

	var out bytes.Buffer
	if err := jpeg.Encode(&out, square(src), &jpeg.Options{Quality: jpegQuality}); err != nil {
		return nil, "", fmt.Errorf("encode jpeg: %w", err)
	}
	return out.Bytes(), contentTypeJPEG, nil
}

// square center-crops an image to at most StoredEdge a side, flattening
// transparency onto white if it has any.
func square(src image.Image) image.Image {
	crop := centered(src.Bounds())
	edge := min(crop.Dx(), StoredEdge)
	dst := image.NewRGBA(image.Rect(0, 0, edge, edge))

	// JPEG has no alpha, so clear pixels would encode black. Ask the image, not
	// the format name, whether it is opaque, so a newly registered decoder is
	// covered. The white must go down before the scale: draw.Src scaling writes
	// transparent black over it.
	op := draw.Src
	if opaque, ok := src.(interface{ Opaque() bool }); !ok || !opaque.Opaque() {
		draw.Draw(dst, dst.Bounds(), image.White, image.Point{}, draw.Src)
		op = draw.Over
	}

	fit(dst, src, crop, op)
	return dst
}

// fit draws src's crop into the whole of dst, resampling only if dst is
// smaller. Catmull-Rom, not ApproxBiLinear: a fixed 2x2 kernel aliases a large
// shrink into moiré. At 1:1 (the browser's upload) resampling would only
// re-quantize every pixel.
func fit(dst *image.RGBA, src image.Image, crop image.Rectangle, op draw.Op) {
	if dst.Bounds().Dx() == crop.Dx() {
		draw.Draw(dst, dst.Bounds(), src, crop.Min, op)
		return
	}
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, crop, op, nil)
}

// centered is the largest square inside a rectangle, taken from its middle.
// The browser crops to the same rule before uploading.
func centered(bounds image.Rectangle) image.Rectangle {
	size := min(bounds.Dx(), bounds.Dy())
	x := bounds.Min.X + (bounds.Dx()-size)/2
	y := bounds.Min.Y + (bounds.Dy()-size)/2
	return image.Rect(x, y, x+size, y+size)
}
