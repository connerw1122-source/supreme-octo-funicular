import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST /api/sessions/[id]/messages
// Body: { sender: 'technician'|'customer'|'system', content: string }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json()
    const sender = (body?.sender ?? '').toString()
    const content = (body?.content ?? '').toString().trim()

    if (!['technician', 'customer', 'system'].includes(sender)) {
      return NextResponse.json({ error: 'Invalid sender' }, { status: 400 })
    }
    if (!content) {
      return NextResponse.json({ error: 'content is required' }, { status: 400 })
    }

    const session = await db.session.findUnique({ where: { id } })
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const msg = await db.chatMessage.create({
      data: { sessionId: session.id, sender, content },
    })

    return NextResponse.json({
      id: msg.id,
      sender: msg.sender,
      content: msg.content,
      createdAt: msg.createdAt,
    })
  } catch (err: any) {
    console.error('POST /api/sessions/[id]/messages error:', err)
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 })
  }
}

// GET /api/sessions/[id]/messages
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await db.session.findUnique({ where: { id } })
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }
    const messages = await db.chatMessage.findMany({
      where: { sessionId: id },
      orderBy: { createdAt: 'asc' },
      take: 500,
    })
    return NextResponse.json({
      messages: messages.map((m) => ({
        id: m.id,
        sender: m.sender,
        content: m.content,
        createdAt: m.createdAt,
      })),
    })
  } catch (err: any) {
    console.error('GET /api/sessions/[id]/messages error:', err)
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 })
  }
}
