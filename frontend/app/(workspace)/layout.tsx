import type { ReactNode } from "react"
import { Workspace } from "../../components/workspace"

export default function Layout({ children }: { children: ReactNode }) {
  return <Workspace>{children}</Workspace>
}
