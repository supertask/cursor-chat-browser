import { NextResponse } from 'next/server'
import { existsSync } from 'fs'
import fs from 'fs/promises'
import path from 'path'
import Database from 'better-sqlite3'
import { resolveWorkspacePath } from '@/utils/workspace-path'
import { getShadowDbPath } from '@/utils/db-manager'

// Helper functions (copied from tabs/route.ts)
function formatToolAction(action: any): string {
  if (!action) return ''
  
  let result = ''
  
  // Handle code changes
  if (action.newModelDiffWrtV0 && action.newModelDiffWrtV0.length > 0) {
    for (const diff of action.newModelDiffWrtV0) {
      if (diff.modified && diff.modified.length > 0) {
        result += `\n\n**Code Changes:**\n\`\`\`\n${diff.modified.join('\n')}\n\`\`\``
      }
    }
  }
  
  // Handle file operations
  if (action.filePath) {
    result += `\n\n**File:** ${action.filePath}`
  }
  
  // Handle terminal commands
  if (action.command) {
    result += `\n\n**Command:** \`${action.command}\``
  }
  
  // Handle search results
  if (action.searchResults) {
    result += `\n\n**Search Results:**\n${action.searchResults}`
  }
  
  // Handle web search results
  if (action.webResults) {
    result += `\n\n**Web Search:**\n${action.webResults}`
  }
  
  // Handle tool actions with specific types
  if (action.toolName) {
    result += `\n\n**Tool Action:** ${action.toolName}`
    
    if (action.parameters) {
      try {
        const params = typeof action.parameters === 'string' ? JSON.parse(action.parameters) : action.parameters
        if (params.command) {
          result += `\n**Command:** \`${params.command}\``
        }
        if (params.target_file) {
          result += `\n**File:** ${params.target_file}`
        }
        if (params.query) {
          result += `\n**Query:** ${params.query}`
        }
        if (params.instructions) {
          result += `\n**Instructions:** ${params.instructions}`
        }
      } catch (error) {
        console.error('Error parsing tool parameters:', error)
      }
    }
    
    if (action.result) {
      try {
        const resultData = typeof action.result === 'string' ? JSON.parse(action.result) : action.result
        if (resultData.output) {
          result += `\n\n**Output:**\n\`\`\`\n${resultData.output}\n\`\`\``
        }
        if (resultData.contents) {
          result += `\n\n**File Contents:**\n\`\`\`\n${resultData.contents}\n\`\`\``
        }
        if (resultData.exitCodeV2 !== undefined) {
          result += `\n\n**Exit Code:** ${resultData.exitCodeV2}`
        }
        if (resultData.files && resultData.files.length > 0) {
          result += `\n\n**Files Found:**`
          for (const file of resultData.files) {
            result += `\n- ${file.name || file.path} (${file.type || 'file'})`
          }
        }
        if (resultData.results && resultData.results.length > 0) {
          result += `\n\n**Results:**`
          for (const searchResult of resultData.results) {
            if (searchResult.file && searchResult.content) {
              result += `\n\n**File:** ${searchResult.file}`
              result += `\n\`\`\`\n${searchResult.content}\n\`\`\``
            }
          }
        }
      } catch (error) {
        console.error('Error parsing tool result:', error)
      }
    }
  }
  
  // Handle actions taken
  if (action.actionsTaken && action.actionsTaken.length > 0) {
    result += `\n\n**Actions Taken:** ${action.actionsTaken.join(', ')}`
  }
  
  // Handle files modified
  if (action.filesModified && action.filesModified.length > 0) {
    result += `\n\n**Files Modified:**`
    for (const file of action.filesModified) {
      result += `\n- ${file}`
    }
  }
  
  // Handle git status
  if (action.gitStatus) {
    result += `\n\n**Git Status:**\n\`\`\`\n${action.gitStatus}\n\`\`\``
  }
  
  // Handle directory listings
  if (action.directoryListed) {
    result += `\n\n**Directory Listed:** ${action.directoryListed}`
  }
  
  // Handle web search results
  if (action.webSearchResults) {
    result += `\n\n**Web Search Results:**`
    for (const searchResult of action.webSearchResults) {
      if (searchResult.title) {
        result += `\n- ${searchResult.title}`
      }
    }
  }
  
  return result
}

function extractTextFromBubble(bubble: any): string {
  let text = ''
  
  // Try to get text from the text field first
  if (bubble.text && bubble.text.trim()) {
    text = bubble.text
  }
  
  // If no text, try to extract from richText
  if (!text && bubble.richText) {
    try {
      const richTextData = JSON.parse(bubble.richText)
      if (richTextData.root && richTextData.root.children) {
        text = extractTextFromRichText(richTextData.root.children)
      }
    } catch (error) {
      console.error('Error parsing richText:', error)
    }
  }
  
  // If it's an AI message with code blocks, include them
  if (bubble.codeBlocks && Array.isArray(bubble.codeBlocks)) {
    for (const codeBlock of bubble.codeBlocks) {
      if (codeBlock.content) {
        text += `\n\n\`\`\`${codeBlock.language || ''}\n${codeBlock.content}\n\`\`\``
      }
    }
  }
  
  return text
}

function extractTextFromRichText(children: any[]): string {
  let text = ''
  
  for (const child of children) {
    if (child.type === 'text' && child.text) {
      text += child.text
    } else if (child.type === 'code' && child.children) {
      text += '\n```\n'
      text += extractTextFromRichText(child.children)
      text += '\n```\n'
    } else if (child.children && Array.isArray(child.children)) {
      text += extractTextFromRichText(child.children)
    }
  }
  
  return text
}

function extractChatIdFromCodeBlockDiffKey(key: string): string | null {
  // key format: codeBlockDiff:<chatId>:<diffId>
  const match = key.match(/^codeBlockDiff:([^:]+):/)
  return match ? match[1] : null
}

export async function GET(
  request: Request,
  { params }: { params: { id: string; tabId: string } }
) {
  let globalDb: any = null
  
  try {
    const globalDbPath = getShadowDbPath()

    if (existsSync(globalDbPath)) {
      globalDb = new Database(globalDbPath, { readonly: true })
      
      // 1. Get Composer Data for this specific tab
      const composerRow = globalDb.prepare("SELECT value FROM cursorDiskKV WHERE key = ?").get(`composerData:${params.tabId}`) as { value: string } | undefined
      
      if (!composerRow) {
         return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
      }

      const composerData = JSON.parse(composerRow.value)
      
      // 2. Get Message Contexts
      const messageRequestContextMap: Record<string, any[]> = {}
      const messageRequestContextRows = globalDb.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE ?").all(`messageRequestContext:${params.tabId}:%`)
      
      for (const rowUntyped of messageRequestContextRows) {
        const row = rowUntyped as { key: string, value: string }
        const parts = row.key.split(':')
        if (parts.length >= 3) {
          const contextId = parts[2]
          try {
            const context = JSON.parse(row.value)
            if (!messageRequestContextMap[params.tabId]) messageRequestContextMap[params.tabId] = []
            messageRequestContextMap[params.tabId].push({
              ...context,
              contextId: contextId
            })
          } catch (parseError) {
            console.error('Error parsing messageRequestContext:', parseError)
          }
        }
      }

      // 3. Get Code Block Diffs
      const codeBlockDiffs: any[] = []
      const codeBlockDiffRows = globalDb.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE ?").all(`codeBlockDiff:${params.tabId}:%`)
      
      for (const rowUntyped of codeBlockDiffRows) {
        const row = rowUntyped as { key: string, value: string }
        try {
          const codeBlockDiff = JSON.parse(row.value)
          codeBlockDiffs.push({
            ...codeBlockDiff,
            diffId: row.key.split(':')[2]
          })
        } catch (parseError) {
          console.error('Error parsing codeBlockDiff:', parseError)
        }
      }

      // 4. Fetch Bubbles
      const conversationHeaders = composerData.fullConversationHeadersOnly || []
      const bubbleIds = conversationHeaders.map((h: any) => h.bubbleId)
      const bubbleMap: Record<string, any> = {}

      if (bubbleIds.length > 0) {
        // Create placeholders for the query
        const placeholders = bubbleIds.map(() => '?').join(',')
        const bubbleKeys = bubbleIds.map((id: string) => `bubbleId:${params.tabId}:${id}`)
        
        const bubbleRows = globalDb.prepare(`SELECT key, value FROM cursorDiskKV WHERE key IN (${placeholders})`).all(bubbleKeys)
        
        for (const rowUntyped of bubbleRows) {
            const row = rowUntyped as { key: string, value: string }
            const bubbleId = row.key.split(':')[2]
            try {
                const bubble = JSON.parse(row.value)
                if (bubble && typeof bubble === 'object') {
                    bubbleMap[bubbleId] = bubble
                }
            } catch (parseError) {
                console.error('Error parsing bubble:', parseError)
            }
        }
      }

      // 5. Construct Response
      const bubbles: any[] = []
      
      for (const header of conversationHeaders) {
        const bubbleId = header.bubbleId
        const bubble = bubbleMap[bubbleId]
        
        if (bubble) {
          const isUser = header.type === 1
          const messageType = isUser ? 'user' : 'ai'
          const text = extractTextFromBubble(bubble)
          
          // Add context (same logic as original)
          let contextText = ''
          const messageContexts = messageRequestContextMap[params.tabId] || []
          for (const context of messageContexts) {
            if (context.bubbleId === bubbleId) {
                 // Add git status if available
                 if (context.gitStatusRaw) {
                    contextText += `\n\n**Git Status:**\n\`\`\`\n${context.gitStatusRaw}\n\`\`\``
                  }
                  
                  // Add terminal files if available
                  if (context.terminalFiles && context.terminalFiles.length > 0) {
                    contextText += `\n\n**Terminal Files:**`
                    for (const file of context.terminalFiles) {
                      contextText += `\n- ${file.path}`
                    }
                  }
                  
                  // Add attached folders if available
                  if (context.attachedFoldersListDirResults && context.attachedFoldersListDirResults.length > 0) {
                    contextText += `\n\n**Attached Folders:**`
                    for (const folder of context.attachedFoldersListDirResults) {
                      if (folder.files && folder.files.length > 0) {
                        contextText += `\n\n**Folder:** ${folder.path || 'Unknown'}`
                        for (const file of folder.files) {
                          contextText += `\n- ${file.name} (${file.type})`
                        }
                      }
                    }
                  }
                  
                  // Add cursor rules if available
                  if (context.cursorRules && context.cursorRules.length > 0) {
                    contextText += `\n\n**Cursor Rules:**`
                    for (const rule of context.cursorRules) {
                      contextText += `\n- ${rule.name || rule.description || 'Rule'}`
                    }
                  }
                  
                  // Add summarized composers if available
                  if (context.summarizedComposers && context.summarizedComposers.length > 0) {
                    contextText += `\n\n**Related Conversations:**`
                    for (const composer of context.summarizedComposers) {
                      contextText += `\n- ${composer.name || composer.composerId || 'Conversation'}`
                    }
                  }
            }
          }

          const fullText = text + contextText
          
          if (fullText.trim()) {
            bubbles.push({
              type: messageType,
              text: fullText,
              timestamp: bubble.timestamp || Date.now()
            })
          }
        }
      }

      // Add tool actions as bubbles
      for (const diff of codeBlockDiffs) {
          const diffText = formatToolAction(diff)
          if (diffText.trim()) {
            bubbles.push({
              type: 'ai',
              text: `**Tool Action:**${diffText}`,
              timestamp: Date.now() // Tool actions often don't have clear timestamps in this structure, defaulting to now or finding better source if possible
            })
          }
      }

      bubbles.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))

      const chatTab = {
        id: params.tabId,
        title: composerData.name || `Conversation ${params.tabId.slice(0, 8)}`,
        timestamp: new Date(composerData.lastUpdatedAt || composerData.createdAt).getTime(),
        bubbles: bubbles
      }

      globalDb.close()
      return NextResponse.json(chatTab)

    } else {
      return NextResponse.json({ error: 'Database not found' }, { status: 404 })
    }
  } catch (error) {
    console.error('Failed to get chat details:', error)
    if (globalDb) globalDb.close()
    return NextResponse.json({ error: 'Failed to get chat details' }, { status: 500 })
  }
}



