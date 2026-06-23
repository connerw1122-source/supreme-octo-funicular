import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST /api/activity/report
// Body: {
//   machineCode: string,
//   mouseClicks: number,
//   keystrokes: number,
//   mouseMoves: number,
//   isActive: boolean,
//   activeAppName: string,
//   activeAppTitle: string,
//   appUsages: [{ appName, windowTitle, duration }],
//   websiteVisits: [{ url, title, browser, duration }],
//   screenshot?: string (base64 JPEG)
// }
//
// Called by the Go agent every 30 seconds with activity data.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const machineCode = (body?.machineCode ?? '').toString().trim().toUpperCase()
    if (!machineCode) {
      return NextResponse.json({ error: 'machineCode is required' }, { status: 400 })
    }

    const machine = await db.unattendedMachine.findUnique({ where: { machineCode } })
    if (!machine) {
      return NextResponse.json({ error: 'Machine not found' }, { status: 404 })
    }

    // 1. Create activity log entry
    const activityLog = await db.activityLog.create({
      data: {
        machineId: machine.id,
        mouseClicks: body.mouseClicks ?? 0,
        keystrokes: body.keystrokes ?? 0,
        mouseMoves: body.mouseMoves ?? 0,
        isActive: body.isActive ?? true,
        activeAppName: body.activeAppName ?? null,
        activeAppTitle: body.activeAppTitle ?? null,
      },
    })

    // 2. Create app usage entries
    if (Array.isArray(body.appUsages)) {
      for (const app of body.appUsages) {
        if (app.appName && app.duration > 0) {
          await db.appUsage.create({
            data: {
              machineId: machine.id,
              appName: app.appName,
              windowTitle: app.windowTitle ?? null,
              category: categorizeApp(app.appName, app.windowTitle),
              duration: app.duration,
            },
          })
        }
      }
    }

    // 3. Create website visit entries
    if (Array.isArray(body.websiteVisits)) {
      for (const site of body.websiteVisits) {
        if (site.url && site.duration > 0) {
          await db.websiteVisit.create({
            data: {
              machineId: machine.id,
              url: site.url,
              title: site.title ?? null,
              browser: site.browser ?? null,
              category: categorizeWebsite(site.url),
              duration: site.duration,
            },
          })
        }
      }
    }

    // 4. Save screenshot if provided
    if (body.screenshot && body.screenshot.startsWith('data:image/jpeg')) {
      // Strip the data URL prefix
      const imageData = body.screenshot
      await db.screenshot.create({
        data: {
          machineId: machine.id,
          imageData,
          width: body.screenshotWidth ?? 320,
          height: body.screenshotHeight ?? 180,
        },
      })
      // Keep only the last 100 screenshots per machine
      const oldShots = await db.screenshot.findMany({
        where: { machineId: machine.id },
        orderBy: { timestamp: 'desc' },
        skip: 100,
        take: 50,
      })
      if (oldShots.length > 0) {
        await db.screenshot.deleteMany({
          where: { id: { in: oldShots.map(s => s.id) } },
        })
      }
    }

    // 5. Update machine status
    await db.unattendedMachine.update({
      where: { id: machine.id },
      data: {
        status: 'online',
        lastSeenAt: new Date(),
      },
    })

    return NextResponse.json({ ok: true, activityLogId: activityLog.id })
  } catch (err: any) {
    console.error('POST /api/activity/report error:', err)
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 })
  }
}

// Categorize an application as productive/unproductive/neutral
function categorizeApp(appName: string, windowTitle?: string): string {
  const name = appName.toLowerCase()
  const productive = ['excel', 'word', 'powerpoint', 'outlook', 'teams', 'slack',
    'visual studio', 'code', 'notepad', 'photoshop', 'illustrator', 'indesign',
    'autoCAD', 'quickbooks', 'sage', 'dynamics', 'salesforce', 'hubspot',
    'terminal', 'powershell', 'cmd', 'git', 'docker', 'figma', 'sketch']
  const unproductive = ['solitaire', 'minecraft', 'steam', 'epic games', 'battle.net',
    'spotify', 'netflix', 'youtube', 'twitch', 'discord', 'reddit']

  for (const p of productive) {
    if (name.includes(p)) return 'productive'
  }
  for (const u of unproductive) {
    if (name.includes(u)) return 'unproductive'
  }
  return 'neutral'
}

// Categorize a website as productive/unproductive/neutral
function categorizeWebsite(url: string): string {
  const lower = url.toLowerCase()
  const productive = ['github.com', 'gitlab.com', 'stackoverflow.com', 'docs.google.com',
    'office.com', 'microsoft365.com', 'salesforce.com', 'hubspot.com', 'jira',
    'trello.com', 'asana.com', 'notion.so', 'figma.com', 'azure', 'aws.amazon']
  const unproductive = ['facebook.com', 'twitter.com', 'instagram.com', 'tiktok.com',
    'reddit.com', 'youtube.com', 'netflix.com', 'twitch.tv', 'pinterest.com',
    'amazon.com', 'ebay.com', 'espn.com', 'ign.com']

  for (const p of productive) {
    if (lower.includes(p)) return 'productive'
  }
  for (const u of unproductive) {
    if (lower.includes(u)) return 'unproductive'
  }
  return 'neutral'
}
