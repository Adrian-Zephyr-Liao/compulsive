import { BranchesOutlined } from "@ant-design/icons";
import { AutoComplete, Flex, Input, Spin, Typography } from "antd";

import { useI18n } from "../../../app/i18n.js";
import type { RepositoryBranch } from "../../../../types.js";

const { Text } = Typography;

export interface BranchSelectProps {
  ariaLabel?: string;
  branches: RepositoryBranch[];
  id?: string;
  loading: boolean;
  name?: string;
  placeholder?: string;
  size?: "small";
  status?: "error";
  value: string;
  onChange: (value: string) => void;
  onFocus: () => void;
}

export function BranchSelect({
  ariaLabel,
  branches,
  id,
  loading,
  name,
  placeholder,
  size,
  status,
  value,
  onChange,
  onFocus,
}: BranchSelectProps) {
  const { t } = useI18n();
  return (
    <AutoComplete
      allowClear
      className="w-full"
      notFoundContent={loading ? <Spin size="small" /> : t("branch.createHint")}
      options={branches.map((branch) => ({
        value: branch.name,
        label: (
          <Flex justify="space-between">
            <Text>{branch.name}</Text>
            <Text type="secondary">
              {branch.local && branch.remote
                ? t("branch.localRemote")
                : branch.local
                  ? t("branch.local")
                  : t("branch.remote")}
            </Text>
          </Flex>
        ),
      }))}
      showSearch={{
        filterOption: (inputValue, option) =>
          String(option?.value ?? "")
            .toLowerCase()
            .includes(inputValue.toLowerCase()),
      }}
      value={value}
      onChange={onChange}
      onFocus={onFocus}
    >
      <Input
        placeholder={placeholder ?? t("branch.placeholder")}
        prefix={<BranchesOutlined />}
        {...(ariaLabel ? { "aria-label": ariaLabel } : {})}
        {...(id ? { id } : {})}
        {...(name ? { name } : {})}
        {...(size ? { size } : {})}
        {...(status ? { status } : {})}
      />
    </AutoComplete>
  );
}
