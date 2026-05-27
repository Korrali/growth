/**
 * Korrali Growth PM2 ecosystem — kept separate from trust/revenue configs.
 * Ports: growth-web-uat 3014, growth-web-prod 3015.
 * Process dirs: /home/ec2-user/growth/{uat,prod}/apps/web
 * Env truth files: /home/ec2-user/growth/.env.{uat,production}
 */
module.exports = {
  apps: [
    {
      name: "growth-web-uat",
      cwd: "/home/ec2-user/growth/uat/apps/web",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3014",
      env_file: "/home/ec2-user/growth/.env.uat",
      env: { NODE_ENV: "production" },
      autorestart: true,
      max_memory_restart: "512M",
      max_restarts: 5,
      out_file: "/home/ec2-user/.pm2/logs/growth-web-uat-out.log",
      error_file: "/home/ec2-user/.pm2/logs/growth-web-uat-error.log",
      time: true,
    },
    {
      name: "growth-web-prod",
      cwd: "/home/ec2-user/growth/prod/apps/web",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3015",
      env_file: "/home/ec2-user/growth/.env.production",
      env: { NODE_ENV: "production" },
      autorestart: true,
      max_memory_restart: "512M",
      max_restarts: 5,
      out_file: "/home/ec2-user/.pm2/logs/growth-web-prod-out.log",
      error_file: "/home/ec2-user/.pm2/logs/growth-web-prod-error.log",
      time: true,
    },
    {
      name: "growth-worker-uat",
      cwd: "/home/ec2-user/growth/uat/apps/web",
      script: "node_modules/.bin/tsx",
      args: "src/worker/index.ts",
      interpreter: "none",
      env_file: "/home/ec2-user/growth/.env.uat",
      env: { NODE_ENV: "production" },
      autorestart: true,
      max_memory_restart: "512M",
      max_restarts: 5,
      out_file: "/home/ec2-user/.pm2/logs/growth-worker-uat-out.log",
      error_file: "/home/ec2-user/.pm2/logs/growth-worker-uat-error.log",
      time: true,
    },
    {
      name: "growth-worker-prod",
      cwd: "/home/ec2-user/growth/prod/apps/web",
      script: "node_modules/.bin/tsx",
      args: "src/worker/index.ts",
      interpreter: "none",
      env_file: "/home/ec2-user/growth/.env.production",
      env: { NODE_ENV: "production" },
      autorestart: true,
      max_memory_restart: "512M",
      max_restarts: 5,
      out_file: "/home/ec2-user/.pm2/logs/growth-worker-prod-out.log",
      error_file: "/home/ec2-user/.pm2/logs/growth-worker-prod-error.log",
      time: true,
    },
  ],
};
