import path from 'path'
import fs from 'fs'
import Database from 'better-sqlite3'
import { resolveWorkspacePath } from './workspace-path'

let cachedDbPath: string | null = null

// Logging function
function logToFile(message: string, level: 'INFO' | 'ERROR' | 'WARN' = 'INFO') {
  try {
    const logDir = path.join(process.cwd(), '.temp', 'log')
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true })
    }

    const logFile = path.join(logDir, 'db-manager.log')
    const timestamp = new Date().toISOString()
    const logEntry = `[${timestamp}] [${level}] ${message}\n`

    fs.appendFileSync(logFile, logEntry)
  } catch (error) {
    console.error('Failed to write log:', error)
  }
}

// Function to get allowed projects from config.json
function getAllowedProjects(): string[] {
  try {
    const configPath = path.join(process.cwd(), 'config.json')
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      return config.allowedProjects || []
    }
  } catch (error) {
    console.error('Failed to read config.json:', error)
  }
  return [] // Return empty array if no config or error
}

// Function to create filtered database with only allowed projects
function createFilteredDatabase(shadowDbPath: string, filteredDbPath: string, allowedProjects: string[]): boolean {
  try {
    console.log('Starting database filtering with hybrid DELETE approach...')
    logToFile('Starting database filtering with hybrid DELETE approach')

    // 1. Copy shadow DB to filtered DB
    fs.copyFileSync(shadowDbPath, filteredDbPath)
    console.log('Database copied to filtered path')
    logToFile('Database copied to filtered path')

    // 2. Open filtered DB for modification
    const db = new Database(filteredDbPath)

    // 3. Get total count before filtering
    const totalCount = db.prepare('SELECT COUNT(*) as count FROM cursorDiskKV').get() as {count: number}
    console.log(`Total records before filtering: ${totalCount.count}`)
    logToFile(`Total records before filtering: ${totalCount.count}`)

    let deletedCount = 0

    if (allowedProjects.length > 0) {
      // 4. Use the same logic as workspaces API to find allowed composers
      const allowedComposerIds = new Set<string>()

      // Get project mappings from messageRequestContext
      const messageContextRows = db.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'messageRequestContext:%'").all() as Array<{key: string, value: string}>
      const projectLayoutsMap: Record<string, string[]> = {}

      for (const row of messageContextRows) {
        const parts = row.key.split(':')
        if (parts.length >= 2) {
          const composerId = parts[1]
          try {
            const context = JSON.parse(row.value)
            if (context && typeof context === 'object' && context.projectLayouts && Array.isArray(context.projectLayouts)) {
              if (!projectLayoutsMap[composerId]) {
                projectLayoutsMap[composerId] = []
              }
              for (const layout of context.projectLayouts) {
                if (typeof layout === 'string') {
                  try {
                    const layoutObj = JSON.parse(layout)
                    if (layoutObj && typeof layoutObj === 'object' && layoutObj.rootPath) {
                      projectLayoutsMap[composerId].push(layoutObj.rootPath)
                    }
                  } catch (parseError) {
                    // Skip invalid JSON
                  }
                }
              }
            }
          } catch (parseError) {
            console.error('Error parsing messageRequestContext:', parseError)
          }
        }
      }

      // Get bubble data for file-based project detection
      const bubbleRows = db.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'bubbleId:%'").all() as Array<{key: string, value: string}>
      const bubbleMap: Record<string, any> = {}

      for (const row of bubbleRows) {
        const bubbleId = row.key.split(':')[2]
        try {
          const bubble = JSON.parse(row.value)
          if (bubble && typeof bubble === 'object') {
            bubbleMap[bubbleId] = bubble
          }
        } catch (parseError) {
          console.error('Error parsing bubble for project detection:', parseError)
        }
      }

      // Determine which composers belong to allowed projects
      const composerRows = db.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'").all() as Array<{key: string, value: string}>

      for (const row of composerRows) {
        const composerId = row.key.split(':')[1]

        try {
          const composerData = JSON.parse(row.value)

          // Skip if composerData is null or not an object
          if (!composerData || typeof composerData !== 'object') {
            continue
          }

          // Use the same logic as workspaces API to determine project
          let projectId = null

          // Check projectLayouts first (most accurate)
          const projectLayouts = projectLayoutsMap[composerId] || []
          for (const projectName of projectLayouts) {
            if (allowedProjects.includes(projectName)) {
              projectId = projectName
              break
            }
          }

          // If no project found, check file-based detection
          if (!projectId) {
            // Check newlyCreatedFiles
            if (composerData.newlyCreatedFiles && Array.isArray(composerData.newlyCreatedFiles)) {
              for (const file of composerData.newlyCreatedFiles) {
                if (file.uri && file.uri.path) {
                  const filePath = file.uri.path.replace(/^\/Users\/[^\/]+\//, '').replace(/^\/mnt\/c\//, 'C:\\').replace(/\//g, '\\')
                  for (const projectName of allowedProjects) {
                    if (filePath.includes(projectName)) {
                      projectId = projectName
                      break
                    }
                  }
                  if (projectId) break
                }
              }
            }

            // Check codeBlockData
            if (!projectId && composerData.codeBlockData && typeof composerData.codeBlockData === 'object') {
              for (const filePath of Object.keys(composerData.codeBlockData)) {
                const normalizedPath = filePath.replace(/^\/Users\/[^\/]+\//, '').replace(/^\/mnt\/c\//, 'C:\\').replace(/\//g, '\\')
                for (const projectName of allowedProjects) {
                  if (normalizedPath.includes(projectName)) {
                    projectId = projectName
                    break
                  }
                }
                if (projectId) break
              }
            }

            // Check relevantFiles in bubbles
            if (!projectId) {
              const conversationHeaders = composerData.fullConversationHeadersOnly || []
              for (const header of conversationHeaders) {
                if (!header || typeof header !== 'object') continue

                const bubbleId = header.bubbleId
                const bubble = bubbleMap[bubbleId]

                if (bubble && typeof bubble === 'object') {
                  // Check relevantFiles
                  if (bubble.relevantFiles && Array.isArray(bubble.relevantFiles)) {
                    for (const filePath of bubble.relevantFiles) {
                      if (filePath && typeof filePath === 'string') {
                        const normalizedPath = filePath.replace(/^\/Users\/[^\/]+\//, '').replace(/^\/mnt\/c\//, 'C:\\').replace(/\//g, '\\')
                        for (const projectName of allowedProjects) {
                          if (normalizedPath.includes(projectName)) {
                            projectId = projectName
                            break
                          }
                        }
                        if (projectId) break
                      }
                    }
                  }

                  // Check attachedFileCodeChunksUris
                  if (!projectId && bubble.attachedFileCodeChunksUris && Array.isArray(bubble.attachedFileCodeChunksUris)) {
                    for (const uri of bubble.attachedFileCodeChunksUris) {
                      if (uri && typeof uri === 'object' && uri.path && typeof uri.path === 'string') {
                        const normalizedPath = uri.path.replace(/^\/Users\/[^\/]+\//, '').replace(/^\/mnt\/c\//, 'C:\\').replace(/\//g, '\\')
                        for (const projectName of allowedProjects) {
                          if (normalizedPath.includes(projectName)) {
                            projectId = projectName
                            break
                          }
                        }
                        if (projectId) break
                      }
                    }
                  }

                  // Check context.fileSelections
                  if (!projectId && bubble.context && typeof bubble.context === 'object' && bubble.context.fileSelections && Array.isArray(bubble.context.fileSelections)) {
                    for (const fileSelection of bubble.context.fileSelections) {
                      if (fileSelection && typeof fileSelection === 'object' && fileSelection.uri && fileSelection.uri.path && typeof fileSelection.uri.path === 'string') {
                        const normalizedPath = fileSelection.uri.path.replace(/^\/Users\/[^\/]+\//, '').replace(/^\/mnt\/c\//, 'C:\\').replace(/\//g, '\\')
                        for (const projectName of allowedProjects) {
                          if (normalizedPath.includes(projectName)) {
                            projectId = projectName
                            break
                          }
                        }
                        if (projectId) break
                      }
                    }
                  }
                }
                if (projectId) break
              }
            }
          }

          // If this composer belongs to an allowed project, mark it for inclusion
          if (projectId) {
            allowedComposerIds.add(composerId)
          }

        } catch (parseError) {
          console.error(`Error parsing composer data for ${composerId}:`, parseError)
        }
      }

      console.log(`Found ${allowedComposerIds.size} composers belonging to allowed projects`)
      logToFile(`Found ${allowedComposerIds.size} composers belonging to allowed projects`)

      // 5. Delete records that don't belong to allowed composers
      if (allowedComposerIds.size > 0) {
        // Convert Set to array for SQL IN clause
        const composerIdArray = Array.from(allowedComposerIds)
        const placeholders = composerIdArray.map(() => '?').join(',')

        // Delete composerData records
        const deleteComposerQuery = `DELETE FROM cursorDiskKV WHERE key LIKE 'composerData:%' AND key NOT IN (${composerIdArray.map(id => `'composerData:${id}'`).join(',')})`
        try {
          const composerDeleteResult = db.prepare(deleteComposerQuery).run()
          deletedCount += composerDeleteResult.changes
          console.log(`Deleted ${composerDeleteResult.changes} composerData records`)
          logToFile(`Deleted ${composerDeleteResult.changes} composerData records`)
        } catch (error) {
          console.warn('Error deleting composerData records:', error)
          logToFile(`Error deleting composerData records: ${error}`, 'WARN')
        }

        // Delete bubbleId records
        const allBubbleRows = db.prepare("SELECT key FROM cursorDiskKV WHERE key LIKE 'bubbleId:%'").all() as Array<{key: string}>
        let deletedBubbles = 0
        const deleteStmt = db.prepare("DELETE FROM cursorDiskKV WHERE key = ?")

        console.log(`Checking ${allBubbleRows.length} bubble records for cleanup...`)
        
        db.transaction(() => {
          for (const row of allBubbleRows) {
            // Key format: bubbleId:composerId:bubbleId
            const parts = row.key.split(':')
            if (parts.length >= 2) {
              const composerId = parts[1]
              if (!allowedComposerIds.has(composerId)) {
                deleteStmt.run(row.key)
                deletedBubbles++
              }
            }
          }
        })()
        
        console.log(`Deleted ${deletedBubbles} bubbleId records`)
        logToFile(`Deleted ${deletedBubbles} bubbleId records`)

        // Delete messageRequestContext records
        const allContextRows = db.prepare("SELECT key FROM cursorDiskKV WHERE key LIKE 'messageRequestContext:%'").all() as Array<{key: string}>
        let deletedContexts = 0

        console.log(`Checking ${allContextRows.length} context records for cleanup...`)

        db.transaction(() => {
          for (const row of allContextRows) {
            // Key format: messageRequestContext:composerId:contextId
            const parts = row.key.split(':')
            if (parts.length >= 2) {
              const composerId = parts[1]
              if (!allowedComposerIds.has(composerId)) {
                deleteStmt.run(row.key)
                deletedContexts++
              }
            }
          }
        })()

        console.log(`Deleted ${deletedContexts} messageRequestContext records`)
        logToFile(`Deleted ${deletedContexts} messageRequestContext records`)

      } else {
        // No allowed composers found, delete all project-specific data
        console.log('No allowed composers found, keeping only system data')
        logToFile('No allowed composers found, keeping only system data')

        const deleteAllQuery = `DELETE FROM cursorDiskKV WHERE key LIKE 'composerData:%' OR key LIKE 'bubbleId:%' OR key LIKE 'messageRequestContext:%'`
        const result = db.prepare(deleteAllQuery).run()
        deletedCount += result.changes
        console.log(`Deleted ${result.changes} project-specific records`)
        logToFile(`Deleted ${result.changes} project-specific records`)
      }

      // 6. Keep all bubbleId records (for conversation integrity) - actually, we need to be more careful here
      // For now, we'll keep them all to maintain functionality
    } else {
      // No filtering needed - keep all records
      console.log('No project filtering configured, keeping all records')
      logToFile('No project filtering configured, keeping all records')
    }

    // 7. Optimize database with VACUUM
    console.log('Optimizing database with VACUUM...')
    logToFile('Optimizing database with VACUUM...')
    db.exec('VACUUM')

    // 8. Get final count
    const finalCount = db.prepare('SELECT COUNT(*) as count FROM cursorDiskKV').get() as {count: number}
    const remainingCount = finalCount.count

    db.close()

    console.log(`Database filtering completed: ${remainingCount} records remaining (${deletedCount} deleted from ${totalCount.count} total)`)
    logToFile(`Database filtering completed successfully: ${remainingCount} records remaining (${deletedCount} deleted from ${totalCount.count} total)`)
    return true

  } catch (error) {
    console.error('Failed to create filtered database:', error)
    logToFile(`Failed to create filtered database: ${error}`, 'ERROR')
    return false
  }
}

export function getShadowDbPath(): string {
  if (cachedDbPath && fs.existsSync(cachedDbPath)) {
    return cachedDbPath
  }

  const workspacePath = resolveWorkspacePath()
  const originalDbPath = path.join(workspacePath, '..', 'globalStorage', 'state.vscdb')
  const tempDir = path.join(process.cwd(), '.temp', 'db')
  const shadowDbPath = path.join(tempDir, 'state.vscdb.shadow')
  const filteredDbPath = path.join(tempDir, 'filtered.vscdb')

  // Create temp directory if it doesn't exist
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true })
  }

  try {
    if (fs.existsSync(originalDbPath)) {
      // First, copy the original DB to shadow path
      fs.copyFileSync(originalDbPath, shadowDbPath)
      console.log(`Database copied to shadow path: ${shadowDbPath}`)
      logToFile(`Database copied to shadow path: ${shadowDbPath}`)

      // Get allowed projects from config
      const allowedProjects = getAllowedProjects()
      console.log(`Allowed projects from config: ${allowedProjects.join(', ')}`)
      logToFile(`Allowed projects from config: ${allowedProjects.join(', ')}`)

      if (allowedProjects.length > 0) {
        // Create filtered database
        const success = createFilteredDatabase(shadowDbPath, filteredDbPath, allowedProjects)
        if (success) {
          // Remove shadow DB and use filtered DB
          fs.unlinkSync(shadowDbPath)
          cachedDbPath = filteredDbPath
          console.log(`Using filtered database: ${filteredDbPath}`)
          logToFile(`Successfully created and switched to filtered database: ${filteredDbPath}`)
          return filteredDbPath
        } else {
          console.warn('Failed to create filtered database, falling back to shadow DB')
          logToFile('Failed to create filtered database, falling back to shadow DB', 'WARN')
          cachedDbPath = shadowDbPath
          return shadowDbPath
        }
      } else {
        // No filtering needed, use shadow DB as-is
        console.log('No allowed projects configured, using full database')
        logToFile('No allowed projects configured, using full database')
        cachedDbPath = shadowDbPath
        return shadowDbPath
      }
    } else {
      console.warn(`Original database not found at: ${originalDbPath}`)
      logToFile(`Original database not found at: ${originalDbPath}`, 'WARN')
      return originalDbPath // Fallback to original path if copy fails (though it will likely fail there too)
    }
  } catch (error) {
    console.error('Failed to copy/setup database:', error)
    return originalDbPath // Fallback
  }
}

export function resetShadowDb() {
  cachedDbPath = null
  // Trigger a re-copy on next get
  getShadowDbPath()
}


