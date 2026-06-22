import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST /api/sessions/[id]/end
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await db.session.findUnique({ where: { id } })
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const updated = await db.session.update({
      where: { id },
      data: { status: 'ended', endedAt: new Date() },
    })

    await db.sessionEvent.create({
      data: { sessionId: id, type: 'ended', detail: 'Session ended' },
    })

    return NextResponse.json({
      id: updated.id,
      status: updated.status,
      endedAt: updated.endedAt,
    })
  } catch (err: any) {
    console.error('POST /api/sessions/[id]/end error:', err)
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 })
  }
}
