//go:build !windows

package main

// Stubs for non-Windows — annotation overlay is Windows-only.
func showAnnotation(relX, relY float64) {}
func hideAnnotationOverlay() {}
