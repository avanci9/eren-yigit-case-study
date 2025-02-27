// metrics.js
const promClient = require('prom-client');

// Create a Registry to register the metrics
const register = new promClient.Registry();

// Add a default label to all metrics
promClient.register.setDefaultLabels({
  app: 'simple-nodejs-app'
});

// Enable collection of default metrics
promClient.collectDefaultMetrics({ register });

// Define custom metrics
const httpRequestsTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status'],
  registers: [register]
});

const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  registers: [register]
});

// Custom business metrics
const activeUsers = new promClient.Gauge({
  name: 'app_active_users',
  help: 'Number of active users',
  labelNames: ['version'],
  registers: [register]
});

const memoryUsage = new promClient.Gauge({
  name: 'app_memory_usage_bytes',
  help: 'Memory usage of the application in bytes',
  registers: [register]
});

// Update memory usage every 15 seconds
setInterval(() => {
  const used = process.memoryUsage().heapUsed;
  memoryUsage.set(used);
}, 15000);

// Express middleware to track request metrics
const metricsMiddleware = (req, res, next) => {
  const start = Date.now();
  
  // Record metrics after response finished
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    const route = req.route ? req.route.path : req.path;
    
    httpRequestsTotal.inc({
      method: req.method,
      route,
      status: res.statusCode
    });
    
    httpRequestDuration.observe(
      {
        method: req.method,
        route,
        status: res.statusCode
      },
      duration
    );
  });
  
  next();
};

module.exports = {
  register,
  metricsMiddleware,
  metrics: {
    httpRequestsTotal,
    httpRequestDuration,
    activeUsers,
    memoryUsage
  }
};