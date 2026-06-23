import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/activity/websites?machineCode=XXX&hours=24
// Returns website visits aggregated by domain
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
    const visits = await db.websiteVisit.findMany({
      where: {
        machineId: machine.id,
        timestamp: { gte: since },
      },
      orderBy: { timestamp: 'desc' },
      take: 500,
    })

    // Aggregate by domain
    const aggregated = new Map<string, { domain: string; category: string; totalDuration: number; lastTitle: string; visitCount: number }>()
    for (const visit of visits) {
      try {
        const domain = new URL(visit.url).hostname
        const existing = aggregated.get(domain)
        if (existing) {
          existing.totalDuration += visit.duration
          existing.visitCount++
          existing.lastTitle = visit.title || existing.lastTitle
        } else {
          aggregated.set(domain, {
            domain,
            category: visit.category,
            totalDuration: visit.duration,
            lastTitle: visit.title || '',
            visitCount: 1,
          })
        }
      } catch {
        // Skip invalid URLs
      }
    }

    const result = Array.from(aggregated.values()).sort((a, b) => b.totalDuration - a.totalDuration)
    return NextResponse.json({ websites: result })
  } catch (err: any) {
    console.error('GET /api/activity/websites error:', err)
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 })
  }
}
