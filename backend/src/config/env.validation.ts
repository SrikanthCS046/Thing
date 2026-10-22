import * as Joi from 'joi';

export const validationSchema = Joi.object({
  PORT: Joi.number().default(3000),
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  APP_NAME: Joi.string().required(),
  APP_VERSION: Joi.string().required(),
  DATABASE_URL: Joi.string().required(),
  REDIS_HOST: Joi.string().default('127.0.0.1'),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().optional().allow(''),
  JWT_ACCESS_SECRET: Joi.string().min(16).required(),
  JWT_REFRESH_SECRET: Joi.string().min(16).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),
  STORAGE_ROOT: Joi.string().optional(),
  EMBEDDING_DIMENSIONS: Joi.number().default(1536),
  AI_SERVICE_URL: Joi.string().uri().default('http://127.0.0.1:8001'),
  GROQ_API_KEY: Joi.string().optional().allow(''),
  GROQ_MODEL: Joi.string().default('openai/gpt-oss-120b'),
  EMBEDDING_MODEL: Joi.string().default('sentence-transformers/all-MiniLM-L6-v2'),
  GITHUB_TOKEN: Joi.string().optional().allow(''),
  GITHUB_OWNER: Joi.string().optional().allow(''),
  GITHUB_REPO: Joi.string().optional().allow(''),
  GITHUB_API_VERSION: Joi.string().default('2022-11-28'),
  JIRA_BASE_URL: Joi.string().optional().allow(''),
  JIRA_EMAIL: Joi.string().optional().allow(''),
  JIRA_API_TOKEN: Joi.string().optional().allow(''),
  SLACK_BOT_TOKEN: Joi.string().optional().allow(''),
});
