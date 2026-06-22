import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST /api/sessions/[id]/join
// Body: { customerName: string }
// Records that a customer has joined the session and marks it active.
// The [id] param may be either a session ID or a 6-character session code.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const normalized = id.toUpperCase().trim()
    const body = await req.json()
    const customerName = (body?.customerName ?? '').toString().trim()

    if (!customerName) {
      return NextResponse.json({ error: 'customerName is required' }, { status: 400 })
    }

    let session = await db.session.findUnique({ where: { id } })
    if (!session) {
      session = await db.session.findUnique({ where: { code: normalized } })
    }
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }
    if (session.status === 'ended') {
      return NextResponse.json({ error: 'Session already ended' }, { status: 410 })
    }

    const updated = await db.session.update({
      where: { id: session.id },
      data: {
        customerName,
        status: 'active',
        startedAt: new Date(),
      },
    })

    await db.sessionEvent.create({
      data: {
        sessionId: session.id,
        type: 'joined',
        detail: `Customer "${customerName}" joined`,
      },
    })

    return NextResponse.json({
      id: updated.id,
      code: updated.code,
      title: updated.title,
      customerName: updated.customerName,
      status: updated.status,
      startedAt: updated.startedAt,
    })
  } catch (err: any) {
    console.error('POST /api/sessions/[id]/join error:', err)
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 })
  }
}
