module.exports = {
  apps: [
    {
      name: "seoul-scent",
      script: "dist/server.js",
      env: { NODE_ENV: "production", PORT: 3000 },
      instances: 1,
      exec_mode: "fork",
      watch: false,
    },
  ],
};
