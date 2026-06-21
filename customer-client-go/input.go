package main

// InputEvent is the JSON shape of an input event from the technician.
// Coordinates are RELATIVE [0..1] for mouse events so they map to any
// screen resolution on the customer side.
type InputEvent struct {
        Type   string  `json:"type"`
        X      float64 `json:"x,omitempty"`
        Y      float64 `json:"y,omitempty"`
        Button string  `json:"button,omitempty"` // "left" | "right" | "middle"
        Key    string  `json:"key,omitempty"`
        Text   string  `json:"text,omitempty"`
        DX     float64 `json:"dx,omitempty"`
        DY     float64 `json:"dy,omitempty"`
}

// HandleInput dispatches an input event to the platform-specific implementation.
// Platform implementations live in input_windows.go, input_darwin.go, and
// input_linux.go.
func HandleInput(event InputEvent) {
        // Stubs for testing — real impls are in the platform files
        switch event.Type {
        case "mouse_move":
                mouseMove(event.X, event.Y)
        case "mouse_down":
                mouseMove(event.X, event.Y)
                mouseDown(event.Button)
        case "mouse_up":
                mouseUp(event.Button)
        case "mouse_click":
                mouseMove(event.X, event.Y)
                mouseDown(event.Button)
                mouseUp(event.Button)
        case "mouse_doubleclick":
                mouseMove(event.X, event.Y)
                mouseDown(event.Button)
                mouseUp(event.Button)
                mouseDown(event.Button)
                mouseUp(event.Button)
        case "mouse_rightclick":
                mouseMove(event.X, event.Y)
                mouseDown("right")
                mouseUp("right")
        case "mouse_scroll":
                // Browser sends dy = -e.deltaY/100 (typically ±1 per wheel notch).
                // Windows MOUSEEVENTF_WHEEL expects multiples of WHEEL_DELTA (120).
                // input_windows.go multiplies by 120, so passing ±1 gives 1 notch.
                // The old *5 multiplier caused 5-notch jumps per scroll — too fast.
                mouseScroll(int(event.DY))
        case "key_down":
                keyDown(event.Key)
        case "key_up":
                keyUp(event.Key)
        case "key_press":
                keyPress(event.Key)
        case "key_type":
                keyType(event.Text)
        }
}
