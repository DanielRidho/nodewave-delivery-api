import { PrismaPg } from "@prisma/adapter-pg";
import { hash } from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";

const connectionString = process.env.DATABASE_URL;
if (!connectionString)
  throw new Error("DATABASE_URL wajib diisi sebelum menjalankan seed.");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});
const passwordHash = await hash("Password123!", 12);

const ids = {
  pm: "seed-user-pm",
  uiux: "seed-user-uiux",
  frontend: "seed-user-frontend",
  backend: "seed-user-backend",
  clientAlpha: "seed-user-client-alpha",
  clientBeta: "seed-user-client-beta",
  alpha: "seed-project-alpha",
  beta: "seed-project-beta",
  discovery: "seed-task-discovery",
  design: "seed-task-design",
  api: "seed-task-api",
  slicing: "seed-task-slicing",
  launch: "seed-task-launch",
  betaPrivate: "seed-task-beta-private",
  betaVisible: "seed-task-beta-visible",
} as const;

const userData = [
  {
    id: ids.pm,
    email: "pm@nodewave.test",
    name: "Maya Product",
    role: "PRODUCT_MANAGER" as const,
    department: "PRODUCT" as const,
  },
  {
    id: ids.uiux,
    email: "uiux@nodewave.test",
    name: "Dina Designer",
    role: "INTERNAL_TEAM" as const,
    department: "UI_UX" as const,
  },
  {
    id: ids.frontend,
    email: "frontend@nodewave.test",
    name: "Fajar Frontend",
    role: "INTERNAL_TEAM" as const,
    department: "FRONTEND" as const,
  },
  {
    id: ids.backend,
    email: "backend@nodewave.test",
    name: "Bima Backend",
    role: "INTERNAL_TEAM" as const,
    department: "BACKEND" as const,
  },
];

async function main() {
  const alpha = await prisma.project.upsert({
    where: { id: ids.alpha },
    update: { deletedAt: null },
    create: {
      id: ids.alpha,
      name: "Nusa Commerce Revamp",
      description:
        "Modernisasi platform commerce untuk meningkatkan conversion dan operational visibility.",
      accessCode: "NUSA-CLIENT-2026",
    },
  });
  const beta = await prisma.project.upsert({
    where: { id: ids.beta },
    update: { deletedAt: null },
    create: {
      id: ids.beta,
      name: "Aruna Mobile Banking",
      description:
        "Project tenant kedua untuk mendemonstrasikan isolasi data client secara absolut.",
      accessCode: "ARUNA-CLIENT-2026",
    },
  });

  for (const user of userData) {
    await prisma.user.upsert({
      where: { id: user.id },
      update: { passwordHash, deletedAt: null },
      create: { ...user, passwordHash },
    });
  }
  await prisma.user.upsert({
    where: { id: ids.clientAlpha },
    update: { passwordHash, clientProjectId: alpha.id, deletedAt: null },
    create: {
      id: ids.clientAlpha,
      email: "client@nusa.test",
      name: "Nusa Client",
      passwordHash,
      role: "CLIENT_GUEST",
      department: "CLIENT",
      clientProjectId: alpha.id,
    },
  });
  await prisma.user.upsert({
    where: { id: ids.clientBeta },
    update: { passwordHash, clientProjectId: beta.id, deletedAt: null },
    create: {
      id: ids.clientBeta,
      email: "client@aruna.test",
      name: "Aruna Client",
      passwordHash,
      role: "CLIENT_GUEST",
      department: "CLIENT",
      clientProjectId: beta.id,
    },
  });

  for (const userId of [ids.uiux, ids.frontend, ids.backend]) {
    await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: alpha.id, userId } },
      update: { deletedAt: null },
      create: { projectId: alpha.id, userId },
    });
  }

  const tasks = [
    {
      id: ids.discovery,
      title: "Product discovery & scope",
      description:
        "Finalisasi problem statement, success metrics, dan ruang lingkup MVP bersama stakeholder.",
      status: "DONE" as const,
      department: "PRODUCT" as const,
      assigneeId: null,
      clientVisible: true,
      projectId: alpha.id,
    },
    {
      id: ids.design,
      title: "Checkout UI/UX design",
      description:
        "Menyelesaikan user flow, wireframe, prototype, dan handoff design system untuk checkout.",
      status: "DONE" as const,
      department: "UI_UX" as const,
      assigneeId: ids.uiux,
      clientVisible: true,
      projectId: alpha.id,
    },
    {
      id: ids.api,
      title: "Checkout API integration",
      description:
        "Membangun endpoint cart, promotion validation, checkout, serta contract response untuk frontend.",
      status: "IN_PROGRESS" as const,
      department: "BACKEND" as const,
      assigneeId: ids.backend,
      clientVisible: false,
      projectId: alpha.id,
    },
    {
      id: ids.slicing,
      title: "Frontend checkout slicing",
      description:
        "Mengimplementasikan checkout responsive berdasarkan handoff design dan kontrak API terbaru.",
      status: "TODO" as const,
      department: "FRONTEND" as const,
      assigneeId: ids.frontend,
      clientVisible: true,
      projectId: alpha.id,
    },
    {
      id: ids.launch,
      title: "Production readiness review",
      description:
        "Memastikan observability, acceptance criteria, dan checklist peluncuran telah terpenuhi.",
      status: "TODO" as const,
      department: "PRODUCT" as const,
      assigneeId: null,
      clientVisible: true,
      projectId: alpha.id,
    },
    {
      id: ids.betaPrivate,
      title: "Fraud engine spike",
      description:
        "Eksperimen internal fraud scoring untuk tenant Aruna yang tidak boleh terlihat oleh tenant lain.",
      status: "IN_PROGRESS" as const,
      department: "BACKEND" as const,
      assigneeId: null,
      clientVisible: false,
      projectId: beta.id,
    },
    {
      id: ids.betaVisible,
      title: "Mobile onboarding milestone",
      description:
        "Milestone onboarding yang boleh dilihat oleh client Aruna saja.",
      status: "DONE" as const,
      department: "UI_UX" as const,
      assigneeId: null,
      clientVisible: true,
      projectId: beta.id,
    },
  ];

  for (const task of tasks) {
    await prisma.task.upsert({
      where: { id: task.id },
      update: { deletedAt: null },
      create: { ...task, createdById: ids.pm },
    });
  }

  for (const prerequisiteTaskId of [ids.design, ids.api]) {
    await prisma.taskDependency.upsert({
      where: {
        taskId_prerequisiteTaskId: { taskId: ids.slicing, prerequisiteTaskId },
      },
      update: { deletedAt: null },
      create: { taskId: ids.slicing, prerequisiteTaskId },
    });
  }
  await prisma.taskDependency.upsert({
    where: {
      taskId_prerequisiteTaskId: {
        taskId: ids.launch,
        prerequisiteTaskId: ids.slicing,
      },
    },
    update: { deletedAt: null },
    create: { taskId: ids.launch, prerequisiteTaskId: ids.slicing },
  });

  const yesterday = new Date(Date.now() - 20 * 60 * 60 * 1000);
  const designAudit = await prisma.auditLog.findUnique({
    where: { id: "seed-audit-design-complete" },
  });
  if (!designAudit) {
    await prisma.auditLog.create({
      data: {
        id: "seed-audit-design-complete",
        taskId: ids.design,
        userId: ids.uiux,
        changedColumn: "status",
        oldValue: "IN_PROGRESS",
        newValue: "DONE",
        createdAt: yesterday,
      },
    });
  }
  const apiAudit = await prisma.auditLog.findUnique({
    where: { id: "seed-audit-api-start" },
  });
  if (!apiAudit) {
    await prisma.auditLog.create({
      data: {
        id: "seed-audit-api-start",
        taskId: ids.api,
        userId: ids.backend,
        changedColumn: "status",
        oldValue: "TODO",
        newValue: "IN_PROGRESS",
        createdAt: yesterday,
      },
    });
  }

  console.log("Seed selesai. Enam akun evaluasi berhasil disiapkan.");
}

await main();
await prisma.$disconnect();
