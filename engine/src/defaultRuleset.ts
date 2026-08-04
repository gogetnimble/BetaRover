/**
 * The bundled default ruleset. It encodes the sample CMA delivery standard as
 * configurable {@link ReviewRule} records. Every tenant-specific value (the
 * `"CMA"` prefix, the approved sender, the logger names) lives in `parameters`
 * and is meant to be overridden by the `br_reviewrule` rows an administrator
 * configures in Dataverse. This file is the single source of truth for the
 * `solution/seed/default-ruleset.json` seed data (see `scripts/emit-seed.ts`).
 */
import type { Ruleset } from './types.js';

export const DEFAULT_RULESET: Ruleset = {
  standardCode: 'CMA-PA-STD',
  standardName: 'CMA Power Automate Delivery Standard',
  version: '1.0.0',
  standardText:
    'Cloud flows are named "CMA - <Area> - <Function>". Flows run as application/service ' +
    'principals, never user principals. Environment-specific configuration is loaded from the ' +
    'CMA Flow Configuration table (Row Count = 1), not hard-coded. Errors are logged to the CMA ' +
    'Flow Logs table via the shared logger child flow. Error handling uses Try/Catch/Finally ' +
    'scopes wired with "configure run after". Email is sent from appdev-no-reply@cma.ca, never a ' +
    'personal account.',
  rules: [
    {
      code: 'NAMING_CONVENTION',
      name: 'Flow naming convention',
      category: 'Naming',
      evaluator: 'namingConvention',
      severity: 'error',
      enabled: true,
      weight: 3,
      parameters: { prefix: 'CMA', separator: ' - ', minSegments: 3 },
      remediation:
        'Rename the flow to "<Prefix> - <Area> - <Function>", e.g. "CMA - Membership - Add new Roles on Contact Creation". Use "System" as the area for system/child flows.',
      description:
        'Flows must be named "<Prefix> - <Area> - <Function>". The prefix also drives WatchFox auto-enable monitoring.',
    },
    {
      code: 'ERROR_HANDLING_SCOPES',
      name: 'Try/Catch/Finally error handling',
      category: 'ErrorHandling',
      evaluator: 'errorHandlingScopes',
      severity: 'error',
      enabled: true,
      weight: 3,
      parameters: {
        tryName: 'Try',
        catchName: 'Catch',
        finallyName: 'Finally',
        requireFinally: true,
        catchRunAfterStatuses: ['Failed', 'TimedOut', 'Skipped'],
        finallyRunAfterStatuses: ['Succeeded', 'Failed', 'TimedOut', 'Skipped'],
      },
      remediation:
        'Wrap the flow body in a "Try" Scope. Add a "Catch" Scope configured to run after Try on Failed/TimedOut/Skipped, and a "Finally" Scope that runs after Catch on all outcomes.',
      description:
        'Implements Try/Catch/Finally using Scopes and "configure run after" to emulate native error handling.',
    },
    {
      code: 'LOGGING_PRESENT',
      name: 'Long-term logging present',
      category: 'Logging',
      evaluator: 'loggingPresent',
      severity: 'warning',
      enabled: true,
      weight: 2,
      parameters: { loggerNameContains: ['Logger', 'Log', 'Validate Logger'], loggerWorkflowIds: [] },
      remediation:
        'Call the shared logging child flow (e.g. "CMA - System - Validate Logger") from your Catch scope, passing Level, Source and Event Details, so history outlives the 28-day Power Automate retention.',
      description:
        'Power Automate keeps run history for only 28 days; durable logs must be written to the CMA Flow Logs table.',
    },
    {
      code: 'CONFIG_LIST_TOP',
      name: 'Bounded list queries (Row Count)',
      category: 'Configuration',
      evaluator: 'configListTop',
      severity: 'warning',
      enabled: true,
      weight: 1,
      parameters: { listOperationIds: ['ListRecords'], topParamNames: ['$top', 'top'] },
      remediation:
        'Set a row count (Top Count / $top) on every "List rows" action. When loading the Flow Configuration record, use Row Count = 1.',
      description:
        'Open-ended Dataverse queries raise Microsoft warnings; configuration is loaded from the Flow Configuration table with Row Count = 1.',
    },
    {
      code: 'APPROVED_EMAIL_SENDER',
      name: 'Approved email sender',
      category: 'Email',
      evaluator: 'approvedEmailSender',
      severity: 'error',
      enabled: true,
      weight: 2,
      parameters: {
        emailOperationIds: ['SendEmailV2', 'SendEmail', 'SharedMailboxSendEmailV2'],
        emailApiIdContains: ['office365', 'outlook', 'gmail'],
        approvedSenders: ['appdev-no-reply@cma.ca'],
        fromParamNames: ['emailMessage/From', 'From', 'MailboxAddress'],
      },
      remediation:
        'Send email using the approved connection (appdev-no-reply@cma.ca). Never send from a personal account.',
      description: 'Outbound email must use the licensed no-reply connection, not a personal account.',
    },
    {
      code: 'RUN_AS_SERVICE_PRINCIPAL',
      name: 'Runs as service principal',
      category: 'Security',
      evaluator: 'runAsServicePrincipal',
      severity: 'warning',
      enabled: true,
      weight: 2,
      parameters: {},
      remediation:
        'Re-own the flow to an application user / service principal governed by an application security role (e.g. "App-Membership"), not a named user.',
      description:
        'Flows should run as application principals with a scoped application security role, never as a user principal.',
    },
    {
      code: 'NO_HARDCODED_ENV',
      name: 'No hard-coded environment values',
      category: 'Configuration',
      evaluator: 'noHardcodedEnv',
      severity: 'warning',
      enabled: true,
      weight: 1,
      parameters: {
        ignoreHostSubstrings: [
          'schema.management.azure.com',
          'schemas.microsoft.com',
          'login.microsoftonline.com',
        ],
        guidCheck: true,
      },
      remediation:
        'Move environment-specific URLs/IDs into the Flow Configuration table and load them at runtime, keyed by Environment / EnvironmentUrl.',
      description:
        'Per-environment values must not be hard-coded; they belong in the Flow Configuration table.',
    },
    {
      code: 'AI_REVIEW',
      name: 'AI holistic review',
      category: 'General',
      evaluator: 'ai',
      severity: 'info',
      enabled: true,
      weight: 1,
      parameters: {},
      remediation: 'Review the AI observations and address any that apply.',
      description:
        'Adds holistic judgement (intent, readability, edge cases) that deterministic rules cannot express. Requires the AI pass to be enabled.',
    },
  ],
};
