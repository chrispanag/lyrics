package testutil

import (
	"bytes"
	"encoding/binary"
	"hash/crc32"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"image/png"
	"testing"
)

// Opaque is the fill SolidPNG takes when a test only cares about the size.
var Opaque = color.NRGBA{R: 0x33, G: 0x66, B: 0x99, A: 0xff}

// SolidPNG encodes a one-color PNG of the given size. It is opaque unless a
// color with a zero alpha is asked for, which is how a test gets the
// transparency that JPEG cannot carry.
func SolidPNG(t testing.TB, width, height int, fill color.NRGBA) []byte {
	t.Helper()

	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	draw.Draw(img, img.Bounds(), image.NewUniform(fill), image.Point{}, draw.Src)

	var out bytes.Buffer
	if err := png.Encode(&out, img); err != nil {
		t.Fatalf("encode png: %v", err)
	}
	return out.Bytes()
}

// SolidJPEG encodes a one-color JPEG of the given size. JPEG carries no alpha,
// so this is the opaque path — and the only format the browser ever uploads,
// which is why it is worth having beside SolidPNG.
func SolidJPEG(t testing.TB, width, height int) []byte {
	t.Helper()

	// Mid-gray: 0x80 luma, and neutral chroma. Leaving Cb and Cr at zero is not
	// gray but the far corner of the color space, which converts to black — a
	// fixture that would fail an assertion about its own pixels for reasons
	// having nothing to do with the code under test.
	img := image.NewYCbCr(image.Rect(0, 0, width, height), image.YCbCrSubsampleRatio420)
	for i := range img.Y {
		img.Y[i] = 0x80
	}
	for i := range img.Cb {
		img.Cb[i] = 0x80
		img.Cr[i] = 0x80
	}

	var out bytes.Buffer
	if err := jpeg.Encode(&out, img, nil); err != nil {
		t.Fatalf("encode jpeg: %v", err)
	}
	return out.Bytes()
}

// PNGHeader builds a PNG that *declares* the given dimensions and carries no
// pixel data whatsoever. Only the header is well formed, which is all a
// decompression bomb needs to be: the size is read from IHDR long before any
// pixels are, so a few dozen bytes here stand in for the gigabytes of bitmap
// that decoding them would allocate.
func PNGHeader(width, height uint32) []byte {
	ihdr := []byte("IHDR")
	ihdr = binary.BigEndian.AppendUint32(ihdr, width)
	ihdr = binary.BigEndian.AppendUint32(ihdr, height)
	// 8 bits per channel, truecolor with alpha, and the only compression,
	// filter and interlace methods PNG defines.
	ihdr = append(ihdr, 8, 6, 0, 0, 0)

	out := []byte("\x89PNG\r\n\x1a\n")
	// A chunk's length counts its data; its checksum covers the type as well.
	out = binary.BigEndian.AppendUint32(out, uint32(len(ihdr)-len("IHDR")))
	out = append(out, ihdr...)
	return binary.BigEndian.AppendUint32(out, crc32.ChecksumIEEE(ihdr))
}
