module.exports = {
  apps: [{
    name: 'quantnexus',
    script: 'server/index.mjs',
    node_args: '--max-old-space-size=12000',
    env: {
      NODE_ENV: 'production',
      PORT: 8787,
    },
    // These get overridden by actual env vars on server
    // DEPLOY_SECRET should be set in environment, not here
  }]
}
