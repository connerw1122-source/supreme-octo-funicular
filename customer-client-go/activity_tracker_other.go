//go:build !windows

package main

import (
        "encoding/json"
        "fmt"
        "net/http"
        "bytes"
        "time"
)

type ActivityData struct {
        MouseClicks   int             `json:"mouseClicks"`
        Keystrokes    int             `json:"keystrokes"`
        MouseMoves    int             `json:"mouseMoves"`
        IsActive      bool            `json:"isActive"`
        ActiveAppName string          `json:"activeAppName"`
        ActiveAppTitle string         `json:"activeAppTitle"`
        AppUsages     []AppUsageData  `json:"appUsages"`
        WebsiteVisits []WebsiteData   `json:"websiteVisits"`
}

type AppUsageData struct {
        AppName     string `json:"appName"`
        WindowTitle string `json:"windowTitle"`
        Duration    int    `json:"duration"`
}

type WebsiteData struct {
        URL      string `json:"url"`
        Title    string `json:"title"`
        Browser  string `json:"browser"`
        Duration int    `json:"duration"`
}

func initActivityHooks() {}

func collectActivityData() ActivityData {
        return ActivityData{
                AppUsages:     []AppUsageData{},
                WebsiteVisits: []WebsiteData{},
                IsActive:      true,
        }
}

func startActivityReporter(serverURL, machineCode string) {
        ticker := time.NewTicker(30 * time.Second)
        defer ticker.Stop()
        for {
                <-ticker.C
                data := collectActivityData()
                reportURL := fmt.Sprintf("%s/api/activity/report", serverURL)
                body, _ := json.Marshal(map[string]interface{}{
                        "machineCode":   machineCode,
                        "mouseClicks":   data.MouseClicks,
                        "keystrokes":    data.Keystrokes,
                        "mouseMoves":    data.MouseMoves,
                        "isActive":      data.IsActive,
                        "activeAppName": data.ActiveAppName,
                        "appUsages":     data.AppUsages,
                        "websiteVisits": data.WebsiteVisits,
                })
                resp, err := http.Post(reportURL, "application/json", bytes.NewReader(body))
                if err != nil {
                        fmt.Printf("[activity] Report failed: %v\n", err)
                } else {
                        resp.Body.Close()
                }
        }
}
