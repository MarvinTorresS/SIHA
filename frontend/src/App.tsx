import { useEffect } from "react"
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom"

import { AppShell } from "@/components/layout/AppShell"
import { DashboardPage } from "@/pages/DashboardPage"
import { HorarioPage } from "@/pages/HorarioPage"
import { MallaPage } from "@/pages/MallaPage"
import { MisCursosPage } from "@/pages/MisCursosPage"
import { LoginPage } from "@/pages/LoginPage"
import { RegistroPage } from "@/pages/RegistroPage"
import { useAuthStore } from "@/store/authStore"
import { Skeleton } from "@/components/ui/skeleton"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"

/**
 * Envuelve las rutas autenticadas: intenta hidratar la sesión desde el
 * token guardado (una sola vez, al montar) y redirige a /login si no
 * hay estudiante después de intentarlo.
 */
function RequireAuth() {
  const estudiante = useAuthStore((s) => s.estudiante)
  const isHydrating = useAuthStore((s) => s.isHydrating)
  const hidratar = useAuthStore((s) => s.hidratar)

  useEffect(() => {
    hidratar()
    // Se hidrata una sola vez al montar -- hidratar() es estable (viene de Zustand).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (isHydrating) {
    return (
      <main className="flex min-h-svh items-center justify-center">
        <Skeleton className="h-8 w-48" />
      </main>
    )
  }

  if (!estudiante) return <Navigate to="/login" replace />

  return <Outlet />
}

function App() {
  return (
    <TooltipProvider>
      <Toaster position="bottom-right" />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/registro" element={<RegistroPage />} />

          <Route element={<RequireAuth />}>
            <Route element={<AppShell />}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/horario" element={<HorarioPage />} />
              <Route path="/malla" element={<MallaPage />} />
              <Route path="/mis-cursos" element={<MisCursosPage />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  )
}

export default App
