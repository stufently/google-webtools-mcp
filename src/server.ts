import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GscApiClient } from './api/client.js';
import { Ga4ApiClient } from './api/ga4-client.js';
import { VerificationApiClient } from './api/verification-client.js';
import { registerSiteTools } from './tools/sites/index.js';
import { registerSitemapTools } from './tools/sitemaps/index.js';
import { registerPerformanceTools } from './tools/performance/index.js';
import { registerOpportunityTools } from './tools/opportunities/index.js';
import { registerIndexingTools } from './tools/indexing/index.js';
import { registerQueryTools } from './tools/queries/index.js';
import { registerReportTools } from './tools/reports/index.js';
import { registerGa4AdminTools } from './tools/ga4-admin/index.js';
import { registerGa4ReportingTools } from './tools/ga4-reporting/index.js';
import { registerVerificationTools } from './tools/verification/index.js';

export function createServer(api: GscApiClient, ga4: Ga4ApiClient, verification: VerificationApiClient): McpServer {
  const server = new McpServer({
    name: 'google-webtools-mcp',
    version: '1.0.0',
  });

  // GSC tools
  registerSiteTools(server, api);
  registerSitemapTools(server, api);
  registerPerformanceTools(server, api);
  registerOpportunityTools(server, api);
  registerIndexingTools(server, api);
  registerQueryTools(server, api);
  registerReportTools(server, api);

  // GA4 tools
  registerGa4AdminTools(server, ga4);
  registerGa4ReportingTools(server, ga4);

  // Verification tools
  registerVerificationTools(server, verification);

  return server;
}
