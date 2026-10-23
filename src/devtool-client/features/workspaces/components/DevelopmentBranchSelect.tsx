import { Flex, Segmented, Typography } from "antd";
import { useI18n } from "../../../app/i18n.js";
import { BranchSelect, type BranchSelectProps } from "./BranchSelect.js";

export function DevelopmentBranchSelect({
  useDefaultBranch,
  onDefaultBranchChange,
  ...branchProps
}: BranchSelectProps & {
  useDefaultBranch: boolean;
  onDefaultBranchChange: (value: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <Flex vertical gap={8}>
      <Segmented
        block
        aria-label={branchProps.ariaLabel ?? t("branch.developmentMode")}
        size={branchProps.size}
        value={useDefaultBranch ? "default" : "custom"}
        options={[
          { label: t("branch.independent"), value: "custom" },
          { label: t("branch.defaultDevelopment"), value: "default" },
        ]}
        onChange={(value) => onDefaultBranchChange(value === "default")}
      />
      {useDefaultBranch ? (
        <Typography.Text type="secondary" className="text-xs">
          {t("branch.defaultDevelopmentHint")}
        </Typography.Text>
      ) : (
        <BranchSelect {...branchProps} />
      )}
    </Flex>
  );
}
