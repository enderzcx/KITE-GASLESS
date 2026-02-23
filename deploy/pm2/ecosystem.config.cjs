module.exports = {
  apps: [
    {
      name: 'kiteclaw-backend',
      script: 'server.js',
      cwd: '/srv/kiteclaw/app/backend',
      env_file: '/srv/kiteclaw/app/backend/.env',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      min_uptime: '10s',
      max_restarts: 20,
      exp_backoff_restart_delay: 200,
      kill_timeout: 10000,
      max_memory_restart: '700M',
      restart_delay: 2000,
      env: {
        NODE_ENV: 'production',
        PORT: '3001',
        AUTO_BTC_PRICE_ENABLED: '1',
        AUTO_BTC_PRICE_INTERVAL_MS: '60000',
        AUTO_BTC_PRICE_SOURCE: 'hyperliquid',
        AUTO_BTC_PRICE_PAIR: 'BTCUSDT'
      },
      out_file: '/srv/kiteclaw/logs/backend.out.log',
      error_file: '/srv/kiteclaw/logs/backend.err.log',
      merge_logs: true,
      time: true,
      log_date_format: 'YYYY-MM-DDTHH:mm:ss.SSSZ'
    }
  ]
};
