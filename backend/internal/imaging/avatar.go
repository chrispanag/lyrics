// Package imaging normalizes an uploaded profile picture into the one form this
// application stores: a centered square, no larger than StoredEdge on a side,
// re-encoded as JPEG.
//
// Re-encoding rather than keeping what arrived is the whole point. A photo from
// a phone carries EXIF metadata — including the GPS coordinates where it was
// taken — that nobody uploading an avatar is thinking about, and re-encoding is
// what removes it. It also means the stored bytes are provably the output of
// Go's JPEG encoder rather than a file that merely begins with the right magic
// bytes, so serving them back can never hand a browser something it will treat
// as anything but an image.
//
// Cropping and shrinking here rather than only in the browser is what makes "a
// stored picture is a small square" true of every row instead of every row a
// well-behaved client wrote. This is the one layer no client can skip, so every
// consumer — the app's avatars today, an email or an OG image later — can rely
// on it.
package imaging

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/jpeg"

	// A drop-in superset of the standard library's image/draw, which has no
	// resampling scaler — it can copy pixels and composite them, but it cannot
	// resize. This is the only reason the dependency is here, and `draw.Draw`
	// below is the same function the standard library exports.
	"golang.org/x/image/draw"

	// Registers the PNG decoder. JPEG's is registered by image/jpeg above.
	// Nothing else is: the browser re-encodes to JPEG before uploading, so this
	// list is about what hostile input may be, not about what a person may
	// choose in a file picker.
	_ "image/png"
)

const (
	// MaxBytes bounds an encoded upload. A picture that has been cropped and
	// shrunk by the browser is a few tens of kilobytes, so this is generous
	// headroom for a client that does neither — it is not a size anything is
	// expected to approach.
	MaxBytes = 1 << 20

	// MaxDimension bounds each side of the decoded image, and so bounds the
	// bitmap this package will allocate. It is a refusal, and it is not the
	// stored size: anything over it is rejected outright, because the cost it
	// guards against is paid by decoding rather than by keeping. StoredEdge is
	// the target — everything between the two is accepted and shrunk.
	MaxDimension = 1024

	// StoredEdge is the edge, in pixels, of the square this package stores.
	// A larger picture is scaled down to it; a smaller one is left alone, since
	// upscaling spends bytes to add nothing.
	//
	// It is the number web/src/lib/image.ts calls AVATAR_SIZE, and it is one
	// decision written in two places rather than two decisions: the largest an
	// avatar is drawn is 80 CSS pixels, 240 device pixels on a 3x screen, and
	// the admin console renders fifty of them at 40px, so every byte over this
	// is paid fifty times on one page load. Bounding it here rather than only
	// in the browser is what makes that true of a client that skipped
	// `toSquareJpeg` — which would otherwise store a full MaxDimension square,
	// sixteen times the pixels, and the admin list would download fifty of
	// those to draw 40px circles.
	//
	// Neither direction of a disagreement between the two numbers fails: the
	// smaller wins. A browser sending less than this passes through untouched
	// (a soft avatar on a dense screen), a browser sending more has its extra
	// pixels thrown away here (upload bytes spent for nothing).
	StoredEdge = 256

	// contentTypeJPEG is what Normalize always produces. Returned with the
	// bytes rather than exported on its own, so the label a caller stores
	// cannot disagree with the format this package encoded.
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

	// The header is read before the pixels, and this ordering is load-bearing: a
	// few kilobytes of PNG can declare 20000x20000, and decoding it allocates
	// the full bitmap — 1.6 GB — before any dimension check downstream of the
	// decode could run.
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, "", fmt.Errorf("%w: %v", ErrUnsupported, err)
	}
	if cfg.Width < 1 || cfg.Height < 1 {
		return nil, "", fmt.Errorf("%w: %s image has no pixels", ErrUnsupported, format)
	}
	if cfg.Width > MaxDimension || cfg.Height > MaxDimension {
		return nil, "", fmt.Errorf("%w: %dx%d pixels", ErrTooLarge, cfg.Width, cfg.Height)
	}

	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, "", fmt.Errorf("%w: %v", ErrUnsupported, err)
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

	// Asked of the image rather than of the format it arrived in. JPEG has no
	// alpha channel, so a transparent source has to be composited onto
	// something — white, because drawn straight across every clear pixel
	// encodes as black and a logo on a clear background is stored as a dark
	// square. Keying that on `format == "png"` instead would make registering
	// one more decoder above reintroduce the black square, in a file with no
	// reason to mention it. The JPEG the browser sends still skips the fill,
	// since a decoded JPEG reports itself opaque.
	//
	// The white goes down first and the picture is composited over it, which is
	// the order that survives the shrink below. Scaling a transparent source
	// with draw.Src writes premultiplied zeroes — transparent black — straight
	// over the fill, so a flatten that ran afterwards would have nothing left
	// to flatten and the dark square would be back.
	if opaque, ok := src.(interface{ Opaque() bool }); !ok || !opaque.Opaque() {
		draw.Draw(dst, dst.Bounds(), image.White, image.Point{}, draw.Src)
		fit(dst, src, crop, draw.Over)
		return dst
	}

	fit(dst, src, crop, draw.Src)
	return dst
}

// fit draws src's crop into the whole of dst, resampling only if dst is
// smaller.
//
// The resampling filter is Catmull-Rom rather than ApproxBiLinear because this
// path exists for the shrink no browser did: MaxDimension down to StoredEdge is
// 4x, and a filter that reads a fixed 2x2 neighborhood reads one source pixel
// in sixteen. On a photograph — hair, a striped shirt, anything with detail near
// the sampling frequency — that aliases into moiré and speckle, which is
// exactly the input a profile picture is. Catmull-Rom widens its kernel with the
// scale factor, so every source pixel contributes to the result.
//
// Skipping the scaler at 1:1 is not an optimization. The browser uploads
// StoredEdge squares, so that is the common path, and running a resampling
// kernel over it would re-quantize every pixel for no change in size.
func fit(dst *image.RGBA, src image.Image, crop image.Rectangle, op draw.Op) {
	if dst.Bounds().Dx() == crop.Dx() {
		draw.Draw(dst, dst.Bounds(), src, crop.Min, op)
		return
	}
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, crop, op, nil)
}

// centered is the largest square inside a rectangle, taken from its middle.
//
// The middle because a portrait photo is mostly background at the bottom and
// mostly head at the top, and squashing it instead would be a caricature. The
// browser crops to the same rule before uploading, so this is normally a no-op
// on what actually arrives.
func centered(bounds image.Rectangle) image.Rectangle {
	size := min(bounds.Dx(), bounds.Dy())
	x := bounds.Min.X + (bounds.Dx()-size)/2
	y := bounds.Min.Y + (bounds.Dy()-size)/2
	return image.Rect(x, y, x+size, y+size)
}
