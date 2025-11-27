import { NextResponse } from 'next/server'
import { existsSync } from 'fs'
import fs from 'fs/promises'
import path from 'path'
import Database from 'better-sqlite3'
import { resolveWorkspacePath } from '@/utils/workspace-path'
import { getShadowDbPath } from '@/utils/db-manager'
import { ComposerData } from '@/types/workspace'
import { ChatTab } from '@/types/workspace'

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
      const composerRows = globalDb.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%' AND value LIKE '%fullConversationHeadersOnly%' AND value NOT LIKE '%fullConversationHeadersOnly\":[]%'").all()
      
      const tabs: Partial<ChatTab>[] = []

      for (const rowUntyped of composerRows) {
        const row = rowUntyped as { key: string, value: string }
        const composerId = row.key.split(':')[1]
        
        try {
          const composerData = JSON.parse(row.value)
          
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
