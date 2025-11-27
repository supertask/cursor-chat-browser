import { NextResponse } from 'next/server'
import { existsSync } from 'fs'
import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import { resolveWorkspacePath } from '@/utils/workspace-path'
import { getShadowDbPath } from '@/utils/db-manager'
import { ComposerData } from '@/types/workspace'
import { ChatTab } from '@/types/workspace'

// Simple file logger
function logSearch(message: string) {
  try {
    const logDir = path.join(process.cwd(), '.temp', 'log')
    if (!fsSync.existsSync(logDir)) {
      fsSync.mkdirSync(logDir, { recursive: true })
    }
    const logFile = path.join(logDir, 'search.log')
    const timestamp = new Date().toISOString()
    fsSync.appendFileSync(logFile, `[${timestamp}] ${message}\n`)
  } catch (e) {
    console.error('Failed to write search log:', e)
  }
}

// Helper function to verify workspace ownership (copied/adapted logic)
function determineProjectForConversation(
  composerData: any, 
  composerId: string,
  projectLayoutsMap: Record<string, string[]>,
  projectNameToWorkspaceId: Record<string, string>,
  workspaceEntries: Array<{name: string, workspaceJsonPath: string}>
): string | null {
  // First, try to get project from projectLayouts (most accurate)
  const projectLayouts = projectLayoutsMap[composerId] || []
  for (const projectName of projectLayouts) {
    const workspaceId = projectNameToWorkspaceId[projectName]
    if (workspaceId) {
      return workspaceId
    }
  }
  
  // If no project found from projectLayouts, try file-based detection (fallback)
  // Check newlyCreatedFiles first
  if (composerData.newlyCreatedFiles && composerData.newlyCreatedFiles.length > 0) {
    for (const file of composerData.newlyCreatedFiles) {
      if (file.uri && file.uri.path) {
        const projectId = getProjectFromFilePath(file.uri.path, workspaceEntries)
        if (projectId) return projectId
      }
    }
  }
  
  // Check codeBlockData
  if (composerData.codeBlockData) {
    for (const filePath of Object.keys(composerData.codeBlockData)) {
      const normalizedPath = filePath.replace('file://', '')
      const projectId = getProjectFromFilePath(normalizedPath, workspaceEntries)
      if (projectId) return projectId
    }
  }
  
  return null
}

function getProjectFromFilePath(filePath: string, workspaceEntries: Array<{name: string, workspaceJsonPath: string}>): string | null {
  // Normalize the file path
  const normalizedPath = filePath.replace(/^\/Users\/evaran\//, '')
  
  for (const entry of workspaceEntries) {
    try {
      const workspaceData = JSON.parse(require('fs').readFileSync(entry.workspaceJsonPath, 'utf-8'))
      if (workspaceData.folder) {
        const workspacePath = workspaceData.folder.replace('file://', '').replace(/^\/Users\/evaran\//, '')
        if (normalizedPath.startsWith(workspacePath)) {
          return entry.name
        }
      }
    } catch (error) {
      console.error(`Error reading workspace ${entry.name}:`, error)
    }
  }
  return null
}

function createProjectNameToWorkspaceIdMap(workspaceEntries: Array<{name: string, workspaceJsonPath: string}>): Record<string, string> {
  const projectNameToWorkspaceId: Record<string, string> = {}
  
  for (const entry of workspaceEntries) {
    try {
      const workspaceData = JSON.parse(require('fs').readFileSync(entry.workspaceJsonPath, 'utf-8'))
      if (workspaceData.folder) {
        const workspacePath = workspaceData.folder.replace('file://', '')
        const folderName = workspacePath.split('/').pop() || workspacePath.split('\\').pop()
        if (folderName) {
          projectNameToWorkspaceId[folderName] = entry.name
        }
      }
    } catch (error) {
      console.error(`Error reading workspace ${entry.name}:`, error)
    }
  }
  
  return projectNameToWorkspaceId
}

// Helper function to extract chat ID from bubble key
function extractChatIdFromBubbleKey(key: string): string | null {
  const match = key.match(/^bubbleId:([^:]+):/)
  return match ? match[1] : null
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  let globalDb: any = null
  
  try {
    const workspacePath = resolveWorkspacePath()
    const globalDbPath = getShadowDbPath()
    const { searchParams } = new URL(request.url)
    const mode = searchParams.get('mode')
    const query = searchParams.get('q')

    if (query) {
      const msg = `[Search] Starting search for query: "${query}" in workspace: ${params.id}`
      console.log(msg)
      logSearch(msg)
    }

    // Get all workspace entries for project mapping
    const entries = await fs.readdir(workspacePath, { withFileTypes: true })
    const workspaceEntries: Array<{name: string, workspaceJsonPath: string}> = []
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const workspaceJsonPath = path.join(workspacePath, entry.name, 'workspace.json')
        if (existsSync(workspaceJsonPath)) {
          workspaceEntries.push({ name: entry.name, workspaceJsonPath })
        }
      }
    }
    
    const projectNameToWorkspaceId = createProjectNameToWorkspaceIdMap(workspaceEntries)

    if (existsSync(globalDbPath)) {
      globalDb = new Database(globalDbPath, { readonly: true })
      
      // Pre-fetch messageRequestContext for project mapping
      const messageRequestContextRows = globalDb.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'messageRequestContext:%'").all()
      const projectLayoutsMap: Record<string, string[]> = {}
      
      for (const rowUntyped of messageRequestContextRows) {
        const row = rowUntyped as { key: string, value: string }
        const parts = row.key.split(':')
        if (parts.length >= 2) {
          const composerId = parts[1]
          try {
            const context = JSON.parse(row.value)
            if (context.projectLayouts && Array.isArray(context.projectLayouts)) {
              if (!projectLayoutsMap[composerId]) {
                projectLayoutsMap[composerId] = []
              }
              for (const layout of context.projectLayouts) {
                if (typeof layout === 'string') {
                    try {
                        const layoutObj = JSON.parse(layout)
                        if (layoutObj.rootPath) {
                            projectLayoutsMap[composerId].push(layoutObj.rootPath)
                        }
                    } catch (e) {}
                }
              }
            }
          } catch (parseError) {}
        }
      }

      // Get composers
      const composerIds = new Set<string>()

      if (query) {
        // 1. Search in composerData (for titles, etc)
        const composerRows = globalDb.prepare(
          "SELECT key FROM cursorDiskKV WHERE key LIKE 'composerData:%' AND value LIKE '%fullConversationHeadersOnly%' AND value NOT LIKE '%fullConversationHeadersOnly\":[]%' AND value LIKE ?"
        ).all(`%${query}%`) as { key: string }[]
        
        composerRows.forEach(row => {
            const id = row.key.split(':')[1]
            if (id) composerIds.add(id)
        })

        // 2. Search in bubbleId (for message content)
        // bubbleId keys format: bubbleId:CHAT_ID:BUBBLE_ID
        const bubbleRows = globalDb.prepare(
            "SELECT key FROM cursorDiskKV WHERE key LIKE 'bubbleId:%' AND value LIKE ?"
        ).all(`%${query}%`) as { key: string }[]

        bubbleRows.forEach(row => {
            const id = extractChatIdFromBubbleKey(row.key)
            if (id) composerIds.add(id)
        })

        const msg = `[Search] Found ${composerIds.size} unique chat IDs matching query (from composers: ${composerRows.length}, bubbles: ${bubbleRows.length})`
        console.log(msg)
        logSearch(msg)

      } else {
        // No query: Get all composers
        const composerRows = globalDb.prepare(
          "SELECT key FROM cursorDiskKV WHERE key LIKE 'composerData:%' AND value LIKE '%fullConversationHeadersOnly%' AND value NOT LIKE '%fullConversationHeadersOnly\":[]%'"
        ).all() as { key: string }[]
        
        composerRows.forEach(row => {
            const id = row.key.split(':')[1]
            if (id) composerIds.add(id)
        })
      }
      
      const tabs: Partial<ChatTab>[] = []

      // Fetch composerData for all identified IDs
      // We need to fetch them one by one or in batches. Since SQLite is local, one by one is fine for reasonable counts.
      // If count is huge, this might be slow, but search results are usually limited.
      
      const stmt = globalDb.prepare("SELECT value FROM cursorDiskKV WHERE key = ?")

      for (const composerId of composerIds) {
        try {
          const row = stmt.get(`composerData:${composerId}`) as { value: string } | undefined
          if (!row) continue

          const composerData = JSON.parse(row.value)

          // If searching, we already filtered by SQL, but we need to re-verify if the match was in bubbleId or composerData.
          // Since we collected IDs from both, we don't need to re-check content here explicitly, 
          // unless we want to highlight or strict check. 
          // The previous strict check on composerData might filter out hits that were only in bubbles.
          // So we SKIP the strict JSON string check here, trusting the SQL results.
          
          // Simplified project detection (skips bubble checks which are slow)
          const projectId = determineProjectForConversation(
            composerData,
            composerId,
            projectLayoutsMap,
            projectNameToWorkspaceId,
            workspaceEntries
          )
          
          if (projectId !== params.id) {
            continue
          }
          
          const title = composerData.name || `Conversation ${composerId.slice(0, 8)}`
          const timestamp = new Date(composerData.lastUpdatedAt || composerData.createdAt).getTime()

          tabs.push({
            id: composerId,
            title,
            timestamp,
            bubbles: [] // Empty bubbles for list mode
          })
          
        } catch (parseError) {
          console.error(`Error parsing composer data for ${composerId}:`, parseError)
        }
      }

      if (query) {
        const msg = `[Search] Found ${tabs.length} matching tabs after filtering by project`
        console.log(msg)
        logSearch(msg)
      }

      globalDb.close()
      return NextResponse.json({ tabs })
      
    } else {
      return NextResponse.json({ error: 'Global storage not found' }, { status: 404 })
    }
  } catch (error) {
    console.error('Failed to get workspace tabs:', error)
    if (globalDb) globalDb.close()
    return NextResponse.json({ error: 'Failed to get workspace tabs' }, { status: 500 })
  }
}
