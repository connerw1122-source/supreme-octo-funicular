import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/activity/score?machineCode=XXX&hours=24
// Returns computed productivity score for the time period
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const machineCode = (searchParams.get('machineCode') || '').toUpperCase().trim()
    const hours = parseInt(searchParams.get('hours') || '24')

    if (!machineCode) {
      return NextResponse.json({ error: 'machineCode is required' }, { status: 400 })
    }

    const machine = await db.unattendedMachine.findUnique({ where: { machineCode } })
    if (!machine) {
      return NextResponse.json({ error: 'Machine not found' }, { status: 404 })
    }

    const since = new Date(Date.now() - hours * 60 * 60 * 1000)

    // Get activity logs
    const logs = await db.activityLog.findMany({
      where: {
        machineId: machine.id,
        timestamp: { gte: since },
      },
      orderBy: { timestamp: 'asc' },
    })

    // Get app usage
    const apps = await db.appUsage.findMany({
      where: {
        machineId: machine.id,
        timestamp: { gte: since },
      },
    })

    // Get website visits
    const websites = await db.websiteVisit.findMany({
      where: {
        machineId: machine.id,
        timestamp: { gte: since },
      },
    })

    // Calculate metrics
    let activeTime = 0
    let idleTime = 0
    let totalClicks = 0
    let totalKeystrokes = 0
    let productiveAppTime = 0
    let unproductiveAppTime = 0
    let neutralAppTime = 0
    let productiveSiteTime = 0
    let unproductiveSiteTime = 0
    let neutralSiteTime = 0

    // Each log represents ~30 seconds
    const intervalSeconds = 30
    for (const log of logs) {
      if (log.isActive) {
        activeTime += intervalSeconds
      } else {
        idleTime += intervalSeconds
      }
      totalClicks += log.mouseClicks
      totalKeystrokes += log.keystrokes
    }

    for (const app of apps) {
      switch (app.category) {
        case 'productive': productiveAppTime += app.duration; break
        case 'unproductive': unproductiveAppTime += app.duration; break
        default: neutralAppTime += app.duration; break
      }
    }

    for (const site of websites) {
      switch (site.category) {
        case 'productive': productiveSiteTime += site.duration; break
        case 'unproductive': unproductiveSiteTime += site.duration; break
        default: neutralSiteTime += site.duration; break
      }
    }

    const totalTime = activeTime + idleTime
    const totalAppTime = productiveAppTime + unproductiveAppTime + neutralAppTime
    const totalSiteTime = productiveSiteTime + unproductiveSiteTime + neutralSiteTime

    // Productivity score formula:
    // - Base: active time ratio (activeTime / totalTime) * 50
    // - App bonus: productive app time / total app time * 30
    // - Site bonus: productive site time / total site time * 20
    // - Penalty: unproductive time reduces score
    let score = 0
    if (totalTime > 0) {
      score += (activeTime / totalTime) * 50
    }
    if (totalAppTime > 0) {
      score += (productiveAppTime / totalAppTime) * 30
      score -= (unproductiveAppTime / totalAppTime) * 15
    }
    if (totalSiteTime > 0) {
      score += (productiveSiteTime / totalSiteTime) * 20
      score -= (unproductiveSiteTime / totalSiteTime) * 10
    }
    score = Math.max(0, Math.min(100, Math.round(score)))

    return NextResponse.json({
      score,
      activeTime,
      idleTime,
      totalTime,
      totalClicks,
      totalKeystrokes,
      apps: {
        productive: productiveAppTime,
        unproductive: unproductiveAppTime,
        neutral: neutralAppTime,
        total: totalAppTime,
      },
      websites: {
        productive: productiveSiteTime,
        unproductive: unproductiveSiteTime,
        neutral: neutralSiteTime,
        total: totalSiteTime,
      },
    })
  } catch (err: any) {
    console.error('GET /api/activity/score error:', err)
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 })
  }
}
