import { db } from ".";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  experiments,
  testCases,
  experimentTestCases,
  experimentResults,
  models,
  experimentModels,
} from "./schema";
import { Logger } from "@/utils/logger";
import {
  ModelAggregation,
  ExperimentResultAggregation,
  CreateExperimentInput,
  CreateTestCaseInput,
  CreateExperimentResultInput,
} from "./types";

const logger = new Logger("db:operations");

// Experiment Operations
export async function createExperiment(input: CreateExperimentInput) {
  const { modelIds, ...experimentData } = input;

  const experiment = await db
    .insert(experiments)
    .values(experimentData)
    .returning();
  const experimentId = experiment[0].id;

  // Create experiment-model relationships
  if (modelIds?.length) {
    await db.insert(experimentModels).values(
      modelIds.map(modelId => ({
        experimentId,
        modelId,
      }))
    );
  }

  // Create experiment-testcase relationships
  if (input.testCaseIds?.length) {
    await db.insert(experimentTestCases).values(
      input.testCaseIds.map(testCaseId => ({
        experimentId,
        testCaseId,
      }))
    );
  }

  return experiment[0];
}

export async function getExperiment(id: string) {
  const result = await db
    .select({
      experiment: experiments,
      models: sql<ModelAggregation[]>`
        COALESCE(
          JSONB_AGG(
            JSONB_BUILD_OBJECT(
              'id', ${models.id},
              'value', ${models.value},
              'label', ${models.label},
              'category', ${models.category}
            )
          ) FILTER (WHERE ${models.id} IS NOT NULL),
          '[]'::JSONB
        )
      `,
    })
    .from(experiments)
    .leftJoin(
      experimentModels,
      eq(experiments.id, experimentModels.experimentId)
    )
    .leftJoin(models, eq(experimentModels.modelId, models.id))
    .where(eq(experiments.id, id))
    .groupBy(experiments.id);

  return result[0];
}

export async function getExperimentWithTestCases(id: string) {
  const result = await db
    .select({
      experiment: experiments,
      testCases: testCases,
    })
    .from(experiments)
    .leftJoin(
      experimentTestCases,
      eq(experiments.id, experimentTestCases.experimentId)
    )
    .leftJoin(testCases, eq(experimentTestCases.testCaseId, testCases.id))
    .where(eq(experiments.id, id));

  return result;
}

// Test Case Operations
export async function createTestCase(input: CreateTestCaseInput) {
  const testCase = await db.insert(testCases).values(input).returning();
  return testCase[0];
}

export async function getTestCase(id: string) {
  const result = await db.select().from(testCases).where(eq(testCases.id, id));
  return result[0];
}

export async function getTestCasesForExperiment(experimentId: string) {
  const result = await db
    .select({
      id: testCases.id,
      userMessage: testCases.userMessage,
      expectedOutput: testCases.expectedOutput,
      metrics: testCases.metrics,
      createdAt: testCases.createdAt,
      results: sql<ExperimentResultAggregation[]>`
        COALESCE(
          JSONB_AGG(
            CASE WHEN ${experimentResults.id} IS NOT NULL THEN
              JSONB_BUILD_OBJECT(
                'id', ${experimentResults.id},
                'response', ${experimentResults.response},
                'exactMatchScore', ${experimentResults.exactMatchScore},
                'llmMatchScore', ${experimentResults.llmMatchScore},
                'cosineSimilarityScore', ${experimentResults.cosineSimilarityScore},
                'metrics', ${experimentResults.metrics},
                'error', ${experimentResults.error},
                'model', JSONB_BUILD_OBJECT(
                  'id', ${models.id},
                  'value', ${models.value},
                  'label', ${models.label},
                  'category', ${models.category}
                )
              )
            END
          ) FILTER (WHERE ${experimentResults.id} IS NOT NULL),
          '[]'::JSONB
        )
      `,
    })
    .from(experimentTestCases)
    .innerJoin(testCases, eq(experimentTestCases.testCaseId, testCases.id))
    .leftJoin(
      experimentResults,
      and(
        eq(experimentResults.testCaseId, testCases.id),
        eq(experimentResults.experimentId, experimentId)
      )
    )
    .leftJoin(models, eq(experimentResults.modelId, models.id))
    .where(eq(experimentTestCases.experimentId, experimentId))
    .groupBy(testCases.id);

  return result;
}

// Experiment Results Operations
export async function createExperimentResult(
  input: CreateExperimentResultInput & { modelId: string }
) {
  try {
    logger.debug("Creating experiment result", { input });

    // Create a clean object with ONLY the values we want to insert, matching schema exactly
    const dbValues = {
      experimentId: input.experimentId,
      modelId: input.modelId,
      testCaseId: input.testCaseId,
      response: input.response,
      metrics: input.metrics,
      error: input.error,
      exactMatchScore: input.exactMatchScore,
      llmMatchScore: input.llmMatchScore,
      cosineSimilarityScore: input.cosineSimilarityScore,
    } satisfies typeof experimentResults.$inferInsert;

    // Validate required fields
    const requiredFields = {
      experimentId: dbValues.experimentId,
      testCaseId: dbValues.testCaseId,
      modelId: dbValues.modelId,
    };

    const missingFields = Object.entries(requiredFields)
      .filter(([, value]) => !value)
      .map(([key]) => key);

    if (missingFields.length > 0) {
      const error = new Error(
        `Missing required fields: ${missingFields.join(", ")}`
      );
      logger.error("Validation failed for experiment result", error, {
        requiredFields,
      });
      throw error;
    }

    logger.debug("Inserting experiment result", { dbValues });
    const result = await db
      .insert(experimentResults)
      .values(dbValues)
      .returning();

    logger.info("Successfully created experiment result", {
      experimentId: result[0].id,
      modelId: result[0].modelId,
      testCaseId: result[0].testCaseId,
    });

    return result[0];
  } catch (error) {
    logger.error("Failed to create experiment result", error);
    throw error;
  }
}

export async function getExperimentResults(experimentId: string) {
  try {
    logger.debug("Fetching experiment results", { experimentId });

    const query = db
      .select({
        id: experimentResults.id,
        experimentId: experimentResults.experimentId,
        modelId: experimentResults.modelId,
        testCaseId: experimentResults.testCaseId,
        response: experimentResults.response,
        exactMatchScore: experimentResults.exactMatchScore,
        llmMatchScore: experimentResults.llmMatchScore,
        cosineSimilarityScore: experimentResults.cosineSimilarityScore,
        metrics: experimentResults.metrics,
        error: experimentResults.error,
        model: sql<ModelAggregation>`
          JSONB_BUILD_OBJECT(
            'id', ${models.id},
            'value', ${models.value},
            'label', ${models.label},
            'category', ${models.category}
          )
        `,
      })
      .from(experimentResults)
      .leftJoin(models, eq(experimentResults.modelId, models.id))
      .where(eq(experimentResults.experimentId, experimentId));

    logger.debug("Executing query", { sql: query.toSQL() });
    const results = await query;

    logger.info("Successfully fetched experiment results", {
      experimentId,
      resultCount: results.length,
    });

    return results;
  } catch (error) {
    logger.error("Failed to fetch experiment results", error, { experimentId });
    throw error;
  }
}

export async function getTestCaseResults(
  experimentId: string,
  testCaseId: string
) {
  const results = await db
    .select()
    .from(experimentResults)
    .where(
      and(
        eq(experimentResults.experimentId, experimentId),
        eq(experimentResults.testCaseId, testCaseId)
      )
    );

  return results[0];
}

export async function listExperiments() {
  const result = await db
    .select({
      id: experiments.id,
      name: experiments.name,
      systemPrompt: experiments.systemPrompt,
      createdAt: experiments.createdAt,
      updatedAt: experiments.updatedAt,
      models: sql<ModelAggregation[]>`
        COALESCE(
          JSONB_AGG(
            JSONB_BUILD_OBJECT(
              'id', ${models.id},
              'value', ${models.value},
              'label', ${models.label},
              'category', ${models.category}
            )
          ) FILTER (WHERE ${models.id} IS NOT NULL),
          '[]'::JSONB
        )
      `,
      testCaseCount: sql<number>`
        CAST((
          SELECT COUNT(*)
          FROM ${experimentTestCases}
          WHERE ${experimentTestCases.experimentId} = ${experiments.id}
        ) AS integer)
      `,
    })
    .from(experiments)
    .leftJoin(
      experimentModels,
      eq(experiments.id, experimentModels.experimentId)
    )
    .leftJoin(models, eq(experimentModels.modelId, models.id))
    .groupBy(experiments.id)
    .orderBy(desc(experiments.createdAt));

  return result;
}

// Model Operations
export async function listModels() {
  return db.select().from(models).orderBy(models.category, models.label);
}

export async function seedModels() {
  const modelData = [
    { value: "gpt-4o", label: "GPT-4o", category: "OpenAI" },
    { value: "gpt-4o-mini", label: "GPT-4o-mini", category: "OpenAI" },
    { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo", category: "OpenAI" },
    {
      value: "gemini-2.0-flash-exp",
      label: "Gemini 2.0 Flash",
      category: "Google",
    },
    {
      value: "gemini-1.5-flash",
      label: "Gemini 1.5 Flash",
      category: "Google",
    },
    {
      value: "llama-3.1-8b-instant",
      label: "LLaMA 3.1 8B Instant",
      category: "Meta",
    },
    {
      value: "llama-3.3-70b-versatile",
      label: "LLaMA 3.3 70B Versatile",
      category: "Meta",
    },
  ];

  await db.insert(models).values(modelData).onConflictDoNothing();
}
