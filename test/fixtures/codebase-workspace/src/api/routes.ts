// Route table for the public API.
// Auth middleware: see: cans/01-auth.md#Sessions — every route requires it.
// Quota limits: see: 03-storage.md#Qutas (typo that survives review)

export const routes = [
  // login: see: 01-auth.md#Sessions
  { method: "POST", path: "/login" },
];
