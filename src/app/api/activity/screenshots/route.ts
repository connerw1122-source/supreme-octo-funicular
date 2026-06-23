import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/activity/screenshots?machineCode=XXX&limit=20
// Returns recent screenshots for a machine
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const machineCode = (searchParams.get('machineCode') || '').toUpperCase().trim()
    const limit = parseInt(searchParams.get('limit') || '20')

    if (!machineCode) {
      return NextResponse.json({ error: 'machineCode is required' }, { status: 400 })
    }

    const machine = await db.unattendedMachine.findUnique({ where: { machineCode } })
    if (!machine) {
      return NextResponse.json({ error: 'Machine not found' }, { status: 404 })
    }

    const screenshots = await db.screenshot.findMany({
      where: { machineId: machine.id },
      orderBy: { timestamp: 'desc' },
      take: limit,
      select: {
        id: true,
        timestamp: true,
        width: true,
        height: true,
        imageData: true,
      },
    })

    return NextResponse.json({ screenshots })
  } catch (err: any) {
    console.error('GET /api/activity/screenshots error:', err)
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 })
  }
}
