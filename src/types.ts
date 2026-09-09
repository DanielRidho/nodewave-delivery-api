import type { Department, Role } from "./generated/prisma/enums";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  department: Department;
  clientProjectId: string | null;
};

export type AppEnv = {
  Variables: {
    user: AuthUser;
    sessionId: string;
  };
};
