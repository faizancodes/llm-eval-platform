import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { TestCase } from "@/types/experiments";
import { useEvaluationStream } from "@/hooks/useEvaluationStream";
import { useEvaluationStore } from "@/stores/evaluation-store";
import useSWR from "swr";
import { Logger } from "@/utils/logger";

const logger = new Logger("hooks: useTestCaseOperations");

const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export function useTestCaseOperations(experimentId: string) {
  const [uploadedTestCases, setUploadedTestCases] = useState<TestCase[]>([]);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();
  const { handleSubmit: handleEvaluationSubmit } = useEvaluationStream();
  const { systemPrompt: currentSystemPrompt, selectedMetrics } =
    useEvaluationStore();

  const { mutate: mutateTestCases } = useSWR(
    `${baseUrl}/api/experiments/${experimentId}/test-cases`
  );
  const { mutate: mutateResults } = useSWR(
    `${baseUrl}/api/experiment-results?experimentId=${experimentId}`
  );

  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
    onSuccess?: () => void
  ) => {
    const file = event.target.files?.[0];
    if (!file) {
      logger.warn("No file selected for upload");
      return;
    }

    logger.info(`Starting file upload: ${file.name}`);
    setIsUploading(true);
    try {
      logger.debug("Reading file contents");
      const content = await file.text();
      const testCases = JSON.parse(content);

      logger.debug(`Parsed ${testCases.length} test cases from file`);

      if (!Array.isArray(testCases)) {
        logger.error("Invalid JSON format: not an array");
        throw new Error("JSON must be an array of test cases");
      }

      const isValid = testCases.every(
        tc =>
          typeof tc === "object" &&
          tc !== null &&
          typeof tc.userMessage === "string" &&
          typeof tc.expectedOutput === "string"
      );

      if (!isValid) {
        logger.error("Invalid test case format detected");
        throw new Error(
          "Each test case must have userMessage and expectedOutput as strings"
        );
      }

      logger.info(
        `Uploading ${testCases.length} validated test cases to server`
      );
      const response = await fetch(
        `${baseUrl}/api/experiments/${experimentId}/test-cases/bulk`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ testCases }),
        }
      );

      if (!response.ok) {
        logger.error(`Server responded with status: ${response.status}`);
        throw new Error("Failed to upload test cases");
      }

      const result = await response.json();
      logger.info(`Successfully uploaded ${result.count} test cases`);
      setUploadedTestCases(result.testCases);
      await mutateTestCases();

      toast({
        title: "Success",
        description: `Uploaded ${result.count} test cases successfully. Click Evaluate to start testing.`,
        variant: "success",
      });

      onSuccess?.();
      event.target.value = "";
    } catch (error) {
      logger.error("Error in file upload process:", error);
      console.error("Error uploading test cases:", error);
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to upload test cases",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
      logger.debug("File upload process completed");
    }
  };

  const handleBulkEvaluation = async (
    selectedModels: string[],
    onSuccess?: () => void
  ) => {
    if (!uploadedTestCases.length) {
      logger.warn("Attempted to evaluate with no test cases");
      toast({
        title: "Error",
        description: "No test cases to evaluate",
        variant: "destructive",
      });
      return;
    }

    logger.info(
      `Starting bulk evaluation for ${selectedModels.length} models and ${uploadedTestCases.length} test cases`
    );
    setIsEvaluating(true);
    try {
      logger.debug(
        `System prompt length: ${currentSystemPrompt.length}, Selected metrics: ${selectedMetrics.join(", ")}`
      );

      for (const testCase of uploadedTestCases) {
        logger.debug(
          `Evaluating test case: ${testCase.userMessage.substring(0, 50)}...`
        );
        await handleEvaluationSubmit({
          systemPrompt: currentSystemPrompt,
          userMessage: testCase.userMessage,
          expectedOutput: testCase.expectedOutput,
          selectedModels,
          selectedMetrics,
        });
      }

      await mutateResults();
      logger.info("Successfully completed bulk evaluation");

      toast({
        title: "Success",
        description: "All test cases have been evaluated",
        variant: "success",
      });

      onSuccess?.();
    } catch (error) {
      logger.error("Error in bulk evaluation:", error);
      console.error("Error evaluating test cases:", error);
      toast({
        title: "Error",
        description: "Failed to evaluate all test cases",
        variant: "destructive",
      });
    } finally {
      setIsEvaluating(false);
      logger.debug("Bulk evaluation process completed");
    }
  };

  return {
    uploadedTestCases,
    isEvaluating,
    isUploading,
    handleFileUpload,
    handleBulkEvaluation,
  };
}
