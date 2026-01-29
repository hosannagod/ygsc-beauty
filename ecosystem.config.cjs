module.exports = {
  apps: [
    {
      name: 'ygsc-beauty',
      script: 'npx',
      args: 'tsx server.ts',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork'
    }
  ]
}
