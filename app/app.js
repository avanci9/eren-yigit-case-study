const express = require('express');
const fs = require('fs');
const path = require('path');

let metricsModule;
try {
  metricsModule = require('./metrics');
} catch (error) {
  // dummy metrics for testing
  metricsModule = {
    register: {
      contentType: 'text/plain',
      metrics: async () => 'mock_metrics'
    },
    metricsMiddleware: (req, res, next) => next(),
    metrics: {
      httpRequestsTotal: { inc: () => {} },
      httpRequestDuration: { observe: () => {} },
      activeUsers: { 
        set: () => {},
        inc: () => {}
      },
      memoryUsage: { set: () => {} }
    }
  };
  console.log('Warning: Prometheus metrics not available');
}

const { register, metricsMiddleware, metrics } = metricsModule;

// Init configuration
const port = process.env.PORT || 3000;
const version = process.env.VERSION || 'v1';
const color = process.env.COLOR || 'blue';
const enableMetrics = process.env.ENABLE_METRICS === 'true';


const app = express();

// Load configuration from mounted ConfigMap if available
let appConfig = {};
try {
  const configPath = path.join(__dirname, 'config', 'app-settings.json');
  if (fs.existsSync(configPath)) {
    appConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    console.log('Loaded application configuration from ConfigMap');
  }
} catch (error) {
  console.error('Error loading configuration:', error);
}

// Add middleware for metrics collection
if (enableMetrics) {
  app.use(metricsMiddleware);
}

// Add middleware for JSON parsing
if (typeof express.json === 'function') {
  app.use(express.json());
}
if (metrics && metrics.activeUsers && typeof metrics.activeUsers.set === 'function') {
  metrics.activeUsers.set({ version }, 0);
}

// Define routes
app.get('/', (req, res) => {
  if (metrics && metrics.activeUsers && typeof metrics.activeUsers.inc === 'function') {
    metrics.activeUsers.inc({ version });
  }
  
  res.json({
    message: 'Hello from DevOps Challenge App!',
    version: version,
    color: color,
    timestamp: new Date(),
    config: {
      timeout: appConfig.timeout || 5000,
      retries: appConfig.retries || 3,
      cacheEnabled: appConfig.cacheEnabled || true
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

// Readiness check endpoint
app.get('/ready', (req, res) => {
  res.status(200).json({ status: 'ready' });
});

// Metrics endpoint
if (enableMetrics) {
  app.get('/metrics', async (req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });
}

// Add error handling
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ 
    error: 'Internal Server Error',
    message: err.message
  });
});

// Start the server if not being required by tests
if (process.env.NODE_ENV !== 'test') {
  const server = app.listen(port, () => {
    console.log(`App listening at http://localhost:${port}`);
    console.log(`Version: ${version}, Color: ${color}`);
    if (enableMetrics) {
      console.log('Metrics enabled at /metrics');
    }
  });

  // Handle graceful shutdown
  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);

  function gracefulShutdown() {
    console.log('Received shutdown signal, closing connections...');
    
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
    
    // Force shutdown after 30s if server hasn't closed
    setTimeout(() => {
      console.error('Forcing shutdown after timeout');
      process.exit(1);
    }, 30000);
  }
}

module.exports = app;