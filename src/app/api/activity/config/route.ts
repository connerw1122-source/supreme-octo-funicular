import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// Default config with built-in app/website categorization
const DEFAULT_CONFIG = {
  activityInterval: 30,
  screenshotInterval: 300,
  idleThreshold: 60,
  screenshotQuality: 40,
  screenshotWidth: 320,
  screenshotHeight: 180,
  maxScreenshots: 100,
  trackMouseClicks: true,
  trackKeystrokes: true,
  trackAppUsage: true,
  trackWebsites: true,
  captureScreenshots: true,
  trackMouseMoves: false,
  productiveApps: ['excel', 'word', 'powerpoint', 'outlook', 'teams', 'slack', 'visual studio', 'code', 'notepad', 'photoshop', 'illustrator', 'indesign', 'autocad', 'quickbooks', 'sage', 'dynamics', 'salesforce', 'hubspot', 'terminal', 'powershell', 'cmd', 'git', 'docker', 'figma', 'sketch'],
  unproductiveApps: ['solitaire', 'minecraft', 'steam', 'epic games', 'battle.net', 'spotify', 'netflix', 'youtube', 'twitch', 'discord', 'reddit'],
  productiveWebsites: ['github.com', 'gitlab.com', 'stackoverflow.com', 'docs.google.com', 'office.com', 'microsoft365.com', 'salesforce.com', 'hubspot.com', 'jira', 'trello.com', 'asana.com', 'notion.so', 'figma.com', 'azure', 'aws.amazon'],
  unproductiveWebsites: ['facebook.com', 'twitter.com', 'instagram.com', 'tiktok.com', 'reddit.com', 'youtube.com', 'netflix.com', 'twitch.tv', 'pinterest.com', 'amazon.com', 'ebay.com', 'espn.com', 'ign.com'],
  retentionDays: 30,
}

// GET /api/activity/config
// Returns the monitoring config (creates default if not exists)
export async function GET() {
  try {
    let config = await db.monitoringConfig.findUnique({ where: { id: 'singleton' } })
    if (!config) {
      config = await db.monitoringConfig.create({
        data: {
          id: 'singleton',
          productiveApps: JSON.stringify(DEFAULT_CONFIG.productiveApps),
          unproductiveApps: JSON.stringify(DEFAULT_CONFIG.unproductiveApps),
          productiveWebsites: JSON.stringify(DEFAULT_CONFIG.productiveWebsites),
          unproductiveWebsites: JSON.stringify(DEFAULT_CONFIG.unproductiveWebsites),
        },
      })
    }
    return NextResponse.json({
      activityInterval: config.activityInterval,
      screenshotInterval: config.screenshotInterval,
      idleThreshold: config.idleThreshold,
      screenshotQuality: config.screenshotQuality,
      screenshotWidth: config.screenshotWidth,
      screenshotHeight: config.screenshotHeight,
      maxScreenshots: config.maxScreenshots,
      trackMouseClicks: config.trackMouseClicks,
      trackKeystrokes: config.trackKeystrokes,
      trackAppUsage: config.trackAppUsage,
      trackWebsites: config.trackWebsites,
      captureScreenshots: config.captureScreenshots,
      trackMouseMoves: config.trackMouseMoves,
      productiveApps: JSON.parse(config.productiveApps),
      unproductiveApps: JSON.parse(config.unproductiveApps),
      productiveWebsites: JSON.parse(config.productiveWebsites),
      unproductiveWebsites: JSON.parse(config.unproductiveWebsites),
      retentionDays: config.retentionDays,
      updatedAt: config.updatedAt,
    })
  } catch (err: any) {
    console.error('GET /api/activity/config error:', err)
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 })
  }
}

// PUT /api/activity/config
// Updates the monitoring config
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()

    // Ensure singleton exists
    let config = await db.monitoringConfig.findUnique({ where: { id: 'singleton' } })
    if (!config) {
      config = await db.monitoringConfig.create({
        data: { id: 'singleton',
          productiveApps: JSON.stringify(DEFAULT_CONFIG.productiveApps),
          unproductiveApps: JSON.stringify(DEFAULT_CONFIG.unproductiveApps),
          productiveWebsites: JSON.stringify(DEFAULT_CONFIG.productiveWebsites),
          unproductiveWebsites: JSON.stringify(DEFAULT_CONFIG.unproductiveWebsites),
        },
      })
    }

    const updated = await db.monitoringConfig.update({
      where: { id: 'singleton' },
      data: {
        ...(body.activityInterval !== undefined ? { activityInterval: body.activityInterval } : {}),
        ...(body.screenshotInterval !== undefined ? { screenshotInterval: body.screenshotInterval } : {}),
        ...(body.idleThreshold !== undefined ? { idleThreshold: body.idleThreshold } : {}),
        ...(body.screenshotQuality !== undefined ? { screenshotQuality: body.screenshotQuality } : {}),
        ...(body.screenshotWidth !== undefined ? { screenshotWidth: body.screenshotWidth } : {}),
        ...(body.screenshotHeight !== undefined ? { screenshotHeight: body.screenshotHeight } : {}),
        ...(body.maxScreenshots !== undefined ? { maxScreenshots: body.maxScreenshots } : {}),
        ...(body.trackMouseClicks !== undefined ? { trackMouseClicks: body.trackMouseClicks } : {}),
        ...(body.trackKeystrokes !== undefined ? { trackKeystrokes: body.trackKeystrokes } : {}),
        ...(body.trackAppUsage !== undefined ? { trackAppUsage: body.trackAppUsage } : {}),
        ...(body.trackWebsites !== undefined ? { trackWebsites: body.trackWebsites } : {}),
        ...(body.captureScreenshots !== undefined ? { captureScreenshots: body.captureScreenshots } : {}),
        ...(body.trackMouseMoves !== undefined ? { trackMouseMoves: body.trackMouseMoves } : {}),
        ...(body.productiveApps !== undefined ? { productiveApps: JSON.stringify(body.productiveApps) } : {}),
        ...(body.unproductiveApps !== undefined ? { unproductiveApps: JSON.stringify(body.unproductiveApps) } : {}),
        ...(body.productiveWebsites !== undefined ? { productiveWebsites: JSON.stringify(body.productiveWebsites) } : {}),
        ...(body.unproductiveWebsites !== undefined ? { unproductiveWebsites: JSON.stringify(body.unproductiveWebsites) } : {}),
        ...(body.retentionDays !== undefined ? { retentionDays: body.retentionDays } : {}),
        updatedAt: new Date(),
      },
    })

    return NextResponse.json({
      ok: true,
      config: {
        activityInterval: updated.activityInterval,
        screenshotInterval: updated.screenshotInterval,
        idleThreshold: updated.idleThreshold,
        screenshotQuality: updated.screenshotQuality,
        screenshotWidth: updated.screenshotWidth,
        screenshotHeight: updated.screenshotHeight,
        maxScreenshots: updated.maxScreenshots,
        trackMouseClicks: updated.trackMouseClicks,
        trackKeystrokes: updated.trackKeystrokes,
        trackAppUsage: updated.trackAppUsage,
        trackWebsites: updated.trackWebsites,
        captureScreenshots: updated.captureScreenshots,
        trackMouseMoves: updated.trackMouseMoves,
        productiveApps: JSON.parse(updated.productiveApps),
        unproductiveApps: JSON.parse(updated.unproductiveApps),
        productiveWebsites: JSON.parse(updated.productiveWebsites),
        unproductiveWebsites: JSON.parse(updated.unproductiveWebsites),
        retentionDays: updated.retentionDays,
      },
    })
  } catch (err: any) {
    console.error('PUT /api/activity/config error:', err)
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 })
  }
}
