import * as Eta from 'eta';
import * as path from 'path';
import {
  ActionsUsage,
  BillingData,
  EnterpriseBillingData,
  EnterpriseOrganizations,
  EnterpriseRespose,
  Organization,
  PackagesUsage,
  SharedStorageUsage
} from './types';
import {GitHub, getOctokitOptions} from '@actions/github/lib/utils';
import {enterpriseCloud} from '@octokit/plugin-enterprise-cloud';

export async function* getEnterpriseOrgsData(
  token: string,
  enterprise: string,
  cursor: string | null = null
): AsyncGenerator<Organization> {
  const MyOctokit = GitHub.plugin(enterpriseCloud);
  const octokit = new MyOctokit(getOctokitOptions(token));

  const organizationQuery = `query($enterprise: String!, $cursor: String) {
    enterprise(slug: $enterprise) {
      organizations(first:10, after: $cursor) {
        totalCount
        nodes {
          name
          login
          organizationBillingEmail
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
    rateLimit {
      cost
      remaining
      resetAt
      limit
    }
  }`;
  const results: EnterpriseRespose<EnterpriseOrganizations> = await octokit.graphql(organizationQuery, {
    enterprise,
    cursor
  });

  for (const org of results.enterprise.organizations.nodes) {
    yield org;
  }

  const {pageInfo} = results.enterprise.organizations;

  if (pageInfo.hasNextPage) {
    const {endCursor} = pageInfo;
    getEnterpriseOrgsData(enterprise, endCursor);
  }
}

export async function getEnterpriseBillingData(token: string, enterprise: string): Promise<BillingData> {
  const MyOctokit = GitHub.plugin(enterpriseCloud);
  const octokit = new MyOctokit(getOctokitOptions(token));

  let actionsUsage = {} as ActionsUsage;
  let packagesUsage = {} as PackagesUsage;
  let sharedStorageUsage = {} as SharedStorageUsage;
  let enterpriseBillingData = {} as EnterpriseRespose<EnterpriseBillingData>;

  const billingInfoQuery = `query($enterprise: String!) {
    enterprise(slug: $enterprise) {
      billingInfo {
        assetPacks
        bandwidthUsage
        bandwidthQuota
        bandwidthUsagePercentage
        storageQuota
        storageUsage
        storageUsagePercentage
        totalLicenses
        allLicensableUsersCount
        totalAvailableLicenses
      }
    }
    rateLimit {
      cost
      remaining
      resetAt
      limit
    }
  }`;

  try {
    enterpriseBillingData = await octokit.graphql(billingInfoQuery, {enterprise});
  } catch (error) {
    throw new Error(`Error querying enterprise billing data: ${error}`);
  }

  try {
    const {data: actionsBilling} = await octokit.billing.getGithubActionsBillingGhe({enterprise});

    actionsUsage = {
      minutesUsed: actionsBilling.total_minutes_used,
      paidMinutesUsed: actionsBilling.total_paid_minutes_used,
      includedMinutes: actionsBilling.included_minutes
    };
  } catch (error) {
    throw new Error(`Error querying Actions Billing GHEC data: ${error}`);
  }

  try {
    const {data: packagesBilling} = await octokit.billing.getGithubPackagesBillingGhe({enterprise});

    packagesUsage = {
      totalGigaBytesBandwidthUsed: packagesBilling.total_gigabytes_bandwidth_used,
      totalPaidGigabytesBandwidthUsed: packagesBilling.total_paid_gigabytes_bandwidth_used,
      includedGigabytesBandwidth: packagesBilling.included_gigabytes_bandwidth
    };
  } catch (error) {
    throw new Error(`Error querying Actions Billing GHEC data: ${error}`);
  }

  try {
    const {data: storageBilling} = await octokit.billing.getSharedStorageBillingGhe({enterprise});

    sharedStorageUsage = {
      daysLeftInCycle: storageBilling.days_left_in_billing_cycle,
      estimatedPaidStorageForMonth: storageBilling.estimated_paid_storage_for_month,
      estimatedStorageForMonth: storageBilling.estimated_storage_for_month
    };
  } catch (error) {
    throw new Error(`Error querying Actions Billing GHEC data: ${error}`);
  }

  return {
    assetPacks: enterpriseBillingData.enterprise.billingInfo.assetPacks,
    bandwidth: {
      usage: enterpriseBillingData.enterprise.billingInfo.bandwidthUsage,
      quota: enterpriseBillingData.enterprise.billingInfo.bandwidthQuota,
      usagePercentage: enterpriseBillingData.enterprise.billingInfo.bandwidthUsagePercentage
    },
    storage: {
      usage: enterpriseBillingData.enterprise.billingInfo.storageUsage,
      quota: enterpriseBillingData.enterprise.billingInfo.storageQuota,
      usagePercentage: enterpriseBillingData.enterprise.billingInfo.storageUsagePercentage
    },
    totalLicenses: enterpriseBillingData.enterprise.billingInfo.totalLicenses,
    allLicensableUsersCount: enterpriseBillingData.enterprise.billingInfo.allLicensableUsersCount,
    totalAvailableLicenses: enterpriseBillingData.enterprise.billingInfo.totalAvailableLicenses,
    actionsUsage,
    packagesUsage,
    sharedStorageUsage
  };
}

export function generateReport(
  title: string,
  enterprise: string,
  organizationData: Organization[],
  billingData: BillingData
): string {
  const templateFn = Eta.loadFile(path.join(__dirname, '/templates/ghec-enterprise-template.tmpl'), {
    filename: 'ghec-enterprise-template.tmpl'
  });
  const data = {
    title,
    enterprise,
    organizations: organizationData,
    ...billingData
  };

  return templateFn(data, Eta.defaultConfig);
}
