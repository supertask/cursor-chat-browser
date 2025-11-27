import { readFileSync, writeFileSync, existsSync } from 'fs'
import path from 'path'
import { NextResponse, NextRequest } from 'next/server'

const CONFIG_PATH = path.join(process.cwd(), 'config.json')

export async function GET() {
  try {
    if (existsSync(CONFIG_PATH)) {
      const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
      return NextResponse.json(config)
    } else {
      // Return default config if file doesn't exist
      return NextResponse.json({
        allowedProjects: []
      })
    }
  } catch (error) {
    console.error('Failed to read config:', error)
    return NextResponse.json({ error: 'Failed to read config' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { allowedProjects } = body

    // Validate input
    if (!Array.isArray(allowedProjects)) {
      return NextResponse.json({ error: 'allowedProjects must be an array' }, { status: 400 })
    }

    // Validate that all items are strings
    if (!allowedProjects.every(item => typeof item === 'string')) {
      return NextResponse.json({ error: 'All allowedProjects must be strings' }, { status: 400 })
    }

    // Remove duplicates and trim whitespace
    const uniqueProjects = [...new Set(allowedProjects.map(p => p.trim()).filter(p => p.length > 0))]

    // Save config
    const config = {
      allowedProjects: uniqueProjects
    }

    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
    console.log(`Config saved: ${uniqueProjects.join(', ')}`)

    return NextResponse.json({ success: true, config })
  } catch (error) {
    console.error('Failed to save config:', error)
    return NextResponse.json({ error: 'Failed to save config' }, { status: 500 })
  }
}
