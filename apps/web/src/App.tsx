import { Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { AuthLayout } from "./components/AuthLayout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { BuildPage } from "./pages/BuildPage";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { NewProjectPage } from "./pages/NewProjectPage";
import { ProjectPage } from "./pages/ProjectPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { RegisterPage } from "./pages/RegisterPage";
import { UsersPage } from "./pages/UsersPage";

export function App() {
  return (
    <Routes>
      <Route element={<AuthLayout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/new" element={<NewProjectPage />} />
          <Route path="/projects/:slug" element={<ProjectPage />} />
          <Route path="/builds/:id" element={<BuildPage />} />
          <Route path="/admin/users" element={<UsersPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
