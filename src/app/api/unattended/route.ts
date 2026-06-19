import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

function generateCode(len = 8): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < len; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return out
}

async function generateUniqueCode(): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = generateCode()
    const existing = await db.unattendedMachine.findUnique({ where: { machineCode: code } })
    if (!existing) return code
  }
  throw new Error('Failed to generate unique machine code')
}

// POST /api/unattended
// Body: { customerName: string }
// Technician generates a setup code to install on a customer's machine.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const customerName = (body?.customerName ?? '').toString().trim()
    if (!customerName) {
      return NextResponse.json({ error: 'customerName is required' }, { status: 400 })
    }
    const machineCode = await generateUniqueCode()
    const machine = await db.unattendedMachine.create({
      data: { machineCode, customerName },
    })
    return NextResponse.json({
      id: machine.id,
      machineCode: machine.machineCode,
      customerName: machine.customerName,
      installedAt: machine.installedAt,
    })
  } catch (err: any) {
    console.error('POST /api/unattended error:', err)
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 })
  }
}

// GET /api/unattended - list all registered machines
export async function GET() {
  try {
    const machines = await db.unattendedMachine.findMany({
      orderBy: { installedAt: 'desc' },
      include: { _count: { select: { sessions: true } } },
    })
    return NextResponse.json({
      machines: machines.map((m) => ({
        id: m.id,
        machineCode: m.machineCode,
        customerName: m.customerName,
        hostname: m.hostname,
        os: m.os,
        status: m.status,
        lastSeenAt: m.lastSeenAt,
        installedAt: m.installedAt,
        sessionCount: m._count.sessions,
      })),
    })
  } catch (err: any) {
    console.error('GET /api/unattended error:', err)
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 })
  }
}
