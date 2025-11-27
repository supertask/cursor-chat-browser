import { Inter } from "next/font/google"
import "./globals.css"
import "../styles/prism-theme.css"
import { Navbar } from "@/components/navbar"
import { Footer } from "@/components/footer"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"

const inter = Inter({ subsets: ["latin"] })

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full">
      <body className={`${inter.className} min-h-full flex flex-col`}>
        <ThemeProvider defaultTheme="dark">
          <TooltipProvider>
            <Navbar />
            <main className="container mx-auto py-4 flex-1 flex flex-col">
              {children}
            </main>
            <Footer />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  )
} 