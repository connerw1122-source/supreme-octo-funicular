import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

function generateCode(): string {
  // 6-digit numeric code
  const digits = '0123456789'
  let out = ''
  for (let i = 0; i < 6; i++) {
    out += digits[Math.floor(Math.random() * digits.length)]
  }
  return out
}

async function generateUniqueCode(): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = generateCode()
    const existing = await db.session.findUnique({ where: { code } })
    if (!existing) return code
  }
  throw new Error('Failed to generate unique session code')
}

// POST /api/sessions
// Body: { title: string, technicianName: string, unattendedMachineCode?: string }
// If unattendedMachineCode is provided, the session is created against that
// pre-registered machine. The customer's unattended client will pick up the
// session on its next heartbeat.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const title = (body?.title ?? '').toString().trim()
    const technicianName = (body?.technicianName ?? 'Technician').toString().trim()
    const unattendedMachineCode = (body?.unattendedMachineCode ?? '').toString().trim().toUpperCase() || null

    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 })
    }

    const code = await generateUniqueCode()

    // Upsert a technician by name (demo: no real auth)
    let technician = await db.technician.findFirst({ where: { name: technicianName } })
    if (!technician) {
      technician = await db.technician.create({
        data: {
          name: technicianName,
          email: `${technicianName.toLowerCase().replace(/\s+/g, '.')}@marqueeit.local`,
          pin: '0000',
        },
      })
    }

    // Look up unattended machine if provided
    let unattendedMachineId: string | undefined
    let customerName: string | undefined
    if (unattendedMachineCode) {
      const machine = await db.unattendedMachine.findUnique({
        where: { machineCode: unattendedMachineCode },
      })
      if (!machine) {
        return NextResponse.json({ error: 'Unattended machine not found' }, { status: 404 })
      }
      unattendedMachineId = machine.id
      customerName = machine.customerName
    }

    const session = await db.session.create({
      data: {
        code,
        title,
        technicianId: technician.id,
        ...(unattendedMachineId ? { unattendedMachineId } : {}),
        ...(customerName ? { customerName } : {}),
        status: unattendedMachineId ? 'waiting' : 'waiting',
        events: {
          create: {
            type: 'created',
            detail: unattendedMachineId
              ? `Unattended session created by ${technicianName} for machine ${unattendedMachineCode}`
              : `Session created by ${technicianName}`,
          },
        },
      },
      include: { technician: true },
    })

    return NextResponse.json({
      id: session.id,
      code: session.code,
      title: session.title,
      status: session.status,
      createdAt: session.createdAt,
      technician: { id: session.technician!.id, name: session.technician!.name },
    })
  } catch (err: any) {
    console.error('POST /api/sessions error:', err)
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 })
  }
}

// GET /api/sessions - list recent sessions (demo: all of them)
export async function GET() {
  try {
    const sessions = await db.session.findMany({
      include: {
        technician: true,
        unattendedMachine: true,
        _count: { select: { messages: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    return NextResponse.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        code: s.code,
        title: s.title,
        customerName: s.customerName,
        status: s.status,
        createdAt: s.createdAt,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        messageCount: s._count.messages,
        technician: s.technician ? { id: s.technician.id, name: s.technician.name } : null,
        unattendedMachineCode: s.unattendedMachine?.machineCode ?? null,
      })),
    })
  } catch (err: any) {
    console.error('GET /api/sessions error:', err)
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 })
  }
}
