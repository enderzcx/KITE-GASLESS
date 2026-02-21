module.exports = {
  apps: [
    {
      name: 'kiteclaw-backend',
      script: 'server.js',
      cwd: '/srv/kiteclaw/app/backend',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      restart_delay: 2000,
      env: {
        NODE_ENV: 'production',
        PORT: '3001'
      },
      out_file: '/srv/kiteclaw/logs/backend.out.log',
      error_file: '/srv/kiteclaw/logs/backend.err.log',
      merge_logs: true,
      time: true
    }
  ]
};
