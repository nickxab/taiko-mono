import dotenv from 'dotenv';
import { promises as fs } from 'fs';
import path from 'path';
import { Project, SourceFile, VariableDeclarationKind } from 'ts-morph';

import configuredBridgesSchema from '../../config/schemas/configuredBridges.schema.json';
import type { BridgeConfig, ConfiguredBridgesType, RoutingMap } from '../../src/libs/bridge/types';
import { decodeBase64ToJson } from '../utils/decodeBase64ToJson';
import { formatSourceFile } from '../utils/formatSourceFile';
import { Logger } from '../utils/Logger';
import { validateJsonAgainstSchema } from '../utils/validateJson';

dotenv.config();
const pluginName = 'generateBridgeConfig';
const logger = new Logger(pluginName);

const currentDir = path.resolve(new URL(import.meta.url).pathname);

const outputPath = path.join(path.dirname(currentDir), '../../src/generated/bridgeConfig.ts');

export function generateBridgeConfig() {
  return {
    name: pluginName,
    async buildStart() {
      if (!process.env.CONFIGURED_BRIDGES) {
        throw new Error(
          'CONFIGURED_BRIDGES is not defined in environment. Make sure to run the export step in the documentation.',
        );
      }

      // Decode base64 encoded JSON string
      const configuredBridgesConfigFile = decodeBase64ToJson(process.env.CONFIGURED_BRIDGES || '');

      // Valide JSON against schema
      const isValid = validateJsonAgainstSchema(configuredBridgesConfigFile, configuredBridgesSchema);

      if (!isValid) {
        throw new Error('encoded configuredBridges.json is not valid.');
      }
      logger.info('Plugin initialized.');

      const tsFilePath = path.resolve(outputPath);

      const project = new Project();
      const notification = `// Generated by ${pluginName} on ${new Date().toLocaleString()}`;
      const warning = `// WARNING: Do not change this file manually as it will be overwritten`;

      let sourceFile = project.createSourceFile(tsFilePath, `${notification}\n${warning}\n`, { overwrite: true });

      // Create the TypeScript content
      sourceFile = await storeTypes(sourceFile);
      sourceFile = await buildBridgeConfig(sourceFile, configuredBridgesConfigFile);

      // Save the file
      await sourceFile.saveSync();
      logger.info(`Generated config file`);

      await sourceFile.saveSync();

      const formatted = await formatSourceFile(tsFilePath);

      // Write the formatted code back to the file
      await fs.writeFile(tsFilePath, formatted);
      logger.info(`Formatted config file saved to ${tsFilePath}`);
    },
  };
}

async function storeTypes(sourceFile: SourceFile) {
  logger.info(`Storing types...`);

  // RoutingMap
  sourceFile.addImportDeclaration({
    namedImports: ['RoutingMap'],
    moduleSpecifier: '$libs/bridge',
    isTypeOnly: true,
  });

  logger.info('Type stored.');
  return sourceFile;
}

async function buildBridgeConfig(sourceFile: SourceFile, configuredBridgesConfigFile: ConfiguredBridgesType) {
  logger.info('Building bridge config...');
  const routingContractsMap: RoutingMap = {};

  const bridges: ConfiguredBridgesType = configuredBridgesConfigFile;

  if (!bridges.configuredBridges || !Array.isArray(bridges.configuredBridges)) {
    logger.error('configuredBridges is not an array. Please check the content of the configuredBridgesConfigFile.');
    throw new Error();
  }

  bridges.configuredBridges.forEach((item: BridgeConfig) => {
    if (!routingContractsMap[item.source]) {
      routingContractsMap[item.source] = {};
    }
    routingContractsMap[item.source][item.destination] = item.addresses;
  });

  // Add routingContractsMap variable
  sourceFile.addVariableStatement({
    declarationKind: VariableDeclarationKind.Const,
    declarations: [
      {
        name: 'routingContractsMap',
        type: 'RoutingMap',
        initializer: _formatObjectToTsLiteral(routingContractsMap),
      },
    ],
    isExported: true,
  });

  logger.info(`Configured ${bridges.configuredBridges.length} bridges.`);
  return sourceFile;
}

const _formatObjectToTsLiteral = (obj: RoutingMap): string => {
  const formatValue = (value: any): string => {
    if (typeof value === 'string') {
      return `"${value}"`;
    }
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      return String(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map(formatValue).join(', ')}]`;
    }
    if (typeof value === 'object') {
      return _formatObjectToTsLiteral(value);
    }
    return 'undefined';
  };

  if (Array.isArray(obj)) {
    return `[${obj.map(formatValue).join(', ')}]`;
  }

  const entries = Object.entries(obj);
  const formattedEntries = entries.map(([key, value]) => `${key}: ${formatValue(value)}`);

  return `{${formattedEntries.join(', ')}}`;
};