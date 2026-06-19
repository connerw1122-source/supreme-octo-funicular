import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST /api/unattended/[machineCode]/heartbeat
// Called periodically by the unattended client to mark itself online.
// Optional body: { hostname?: string, os?: string }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ machineCode: string }> }
) {
  try {
    const { machineCode } = await params
    const normalized = machineCode.toUpperCase().trim()
    const body = await req.json().catch(() => ({}))

    const machine = await db.unattendedMachine.findUnique({ where: { machineCode: normalized } })
    if (!machine) {
      return NextResponse.json({ error: 'Invalid machine code' }, { status: 404 })
    }

    await db.unattendedMachine.update({
      where: { id: machine.id },
      data: {
        status: 'online',
        lastSeenAt: new Date(),
        ...(body?.hostname ? { hostname: String(body.hostname) } : {}),
        ...(body?.os ? { os: String(body.os) } : {}),
      },
    })

    // Check if there's a pending session waiting for this machine
    const pendingSession = await db.session.findFirst({
      where: {
        unattendedMachineId: machine.id,
        status: 'waiting',
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({
      ok: true,
      // If a technician asked to connect, the client should auto-join that session
      pendingSessionCode: pendingSession?.code ?? null,
      pendingSessionId: pendingSession?.id ?? null,
    })
  } catch (err: any) {
    console.error('POST /api/unattended/[machineCode]/heartbeat error:', err)
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 })
  }
}
