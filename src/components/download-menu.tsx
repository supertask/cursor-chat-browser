"use client"

import { useState } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Download, RefreshCw } from "lucide-react"
import { ChatTab } from "@/types/workspace"
import { downloadMarkdown, downloadPDF, downloadHTML, downloadAllAsMarkdown, downloadAllAsHTML, downloadAllAsPDF } from "@/lib/download"

interface DownloadMenuProps {
  tab: ChatTab
  allTabs?: ChatTab[]
  workspaceId: string
}

export function DownloadMenu({ tab, allTabs, workspaceId }: DownloadMenuProps) {
  const [isDownloadingAll, setIsDownloadingAll] = useState(false)

  const handleDownloadAll = async (downloadFn: (tabs: ChatTab[], workspaceId: string) => Promise<void>) => {
    if (!allTabs || allTabs.length === 0) return
    
    setIsDownloadingAll(true)
    try {
      await downloadFn(allTabs, workspaceId)
    } catch (error) {
      console.error('Failed to download all:', error)
    } finally {
      setIsDownloadingAll(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={isDownloadingAll}>
          {isDownloadingAll ? (
            <>
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              Downloading...
            </>
          ) : (
            <>
              <Download className="w-4 h-4 mr-2" />
              Download
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => downloadMarkdown(tab)} disabled={isDownloadingAll}>
          Download as Markdown
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => downloadHTML(tab)} disabled={isDownloadingAll}>
          Download as HTML
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => downloadPDF(tab)} disabled={isDownloadingAll}>
          Download as PDF
        </DropdownMenuItem>
        {allTabs && allTabs.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem 
              onClick={() => handleDownloadAll(downloadAllAsMarkdown)}
              disabled={isDownloadingAll}
            >
              {isDownloadingAll ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Downloading All as Markdown (ZIP)...
                </>
              ) : (
                "Download All as Markdown (ZIP)"
              )}
            </DropdownMenuItem>
            <DropdownMenuItem 
              onClick={() => handleDownloadAll(downloadAllAsHTML)}
              disabled={isDownloadingAll}
            >
              {isDownloadingAll ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Downloading All as HTML (ZIP)...
                </>
              ) : (
                "Download All as HTML (ZIP)"
              )}
            </DropdownMenuItem>
            <DropdownMenuItem 
              onClick={() => handleDownloadAll(downloadAllAsPDF)}
              disabled={isDownloadingAll}
            >
              {isDownloadingAll ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Downloading All as PDF (ZIP)...
                </>
              ) : (
                "Download All as PDF (ZIP)"
              )}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
} 