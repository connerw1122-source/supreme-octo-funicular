package main

import (
        "encoding/base64"
        "image"
        "image/jpeg"
        "bytes"
        "strings"
)

// base64Encode encodes bytes to a base64 string
func base64Encode(data []byte) string {
        return base64.StdEncoding.EncodeToString(data)
}

// encodeJPEG encodes an image.RGBA to JPEG bytes
func encodeJPEG(img *image.RGBA, quality int) ([]byte, error) {
        var buf bytes.Buffer
        err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: quality})
        return buf.Bytes(), err
}

// downscaleImage resizes an image to fit within the given dimensions
// while preserving aspect ratio. Uses nearest-neighbor for speed.
func downscaleImage(img *image.RGBA, maxW, maxH int) *image.RGBA {
        bounds := img.Bounds()
        srcW := bounds.Dx()
        srcH := bounds.Dy()

        // Calculate destination dimensions preserving aspect ratio
        scale := float64(maxW) / float64(srcW)
        if float64(srcH)*scale > float64(maxH) {
                scale = float64(maxH) / float64(srcH)
        }
        dstW := int(float64(srcW) * scale)
        dstH := int(float64(srcH) * scale)
        if dstW < 1 { dstW = 1 }
        if dstH < 1 { dstH = 1 }

        dst := image.NewRGBA(image.Rect(0, 0, dstW, dstH))
        for y := 0; y < dstH; y++ {
                srcY := int(float64(y) / scale)
                if srcY >= srcH { srcY = srcH - 1 }
                for x := 0; x < dstW; x++ {
                        srcX := int(float64(x) / scale)
                        if srcX >= srcW { srcX = srcW - 1 }
                        srcIdx := (srcY*srcW + srcX) * 4
                        dstIdx := (y*dstW + x) * 4
                        dst.Pix[dstIdx+0] = img.Pix[srcIdx+0]
                        dst.Pix[dstIdx+1] = img.Pix[srcIdx+1]
                        dst.Pix[dstIdx+2] = img.Pix[srcIdx+2]
                        dst.Pix[dstIdx+3] = 255
                }
        }
        return dst
}
