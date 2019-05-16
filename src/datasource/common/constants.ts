import * as _ from 'lodash';
import { SERVICES } from '../tc_monitor';
import Sign from './sign';

// the services of tencentcloud monitor api
const FINACE_REGIONS = ['ap-shanghai-fsi', 'ap-shenzhen-fsi'];

const SERVICES_API_INFO = {
  // cvm api info
  cvm: {
    service: 'cvm',
    version: '2017-03-12',
    path: '/cvm',
    host: 'cvm.tencentcloudapi.com',
  },
  // cdb api info
  cdb: {
    service: 'cdb',
    version: '2017-03-20',
    path: '/cdb',
    host: 'cdb.tencentcloudapi.com',
  },
  // monitor api info
  monitor: {
    service: 'monitor',
    version: '2018-07-24',
    path: '/monitor',
    host: 'monitor.tencentcloudapi.com',
  }
};

const FINACE_HOST = {
  cvm: {
    'ap-shanghai-fsi': {
      path: '/fsi/cvm/shanghai',
      host: 'cvm.ap-shanghai-fsi.tencentcloudapi.com',
    },
    'ap-shenzhen-fsi': {
      path: '/fsi/cvm/shenzhen',
      host: 'cvm.ap-shenzhen-fsi.tencentcloudapi.com',
    }
  },
  cdb: {
    'ap-shanghai-fsi': {
      path: '/fsi/cdb/shanghai',
      host: 'cdb.ap-shanghai-fsi.tencentcloudapi.com',
    },
    'ap-shenzhen-fsi': {
      path: '/fsi/cdb/shenzhen',
      host: 'cdb.ap-shenzhen-fsi.tencentcloudapi.com',
    }
  },
  monitor: {
    'ap-shanghai-fsi': {
      path: '/fsi/monitor/shanghai',
      host: 'monitor.ap-shanghai-fsi.tencentcloudapi.com',
    },
    'ap-shenzhen-fsi': {
      path: '/fsi/monitor/shenzhen',
      host: 'monitor.ap-shenzhen-fsi.tencentcloudapi.com',
    }
  }
};

// 获取对应业务的 API 接口信息
export function GetServiceAPIInfo(region, service) {
  return Object.assign({}, SERVICES_API_INFO[service] || {}, getHostAndPath(region, service));
}

  // get host and path for finance regions
function getHostAndPath(region, service) {
    if (_.indexOf(FINACE_REGIONS, region) === -1) {
      return {};
    }
    return _.find(_.find(FINACE_HOST, (__, key) => key === service), (__, key) => key === region) || {};
  }

// 变量替换指定实例按照那个字段展示
export const VARIABLE_ALIAS = 'instancealias';

export function GetServiceFromNamespace(namespace) {
  return _.get(_.find(SERVICES, service => service.namespace === namespace), 'service');
}

// parse template variable query params
export function ParseMetricQuery(query = '') {
  if (!query) {
    return {};
  }
  const result = {};
  const queries = _.split(query, '&');
  _.forEach(queries, item => {
    const str = _.split(item, '=');
    if (_.trim(_.get(str, '0', ''))) {
      result[_.toLower(_.trim(_.get(str, '0', '')))] = _.trim(_.get(str, '1', ''));
    }
  });
  return result;
}

// get the actual value of template variable
function parseVariableFormat(varname: string) {
  varname = String(varname || '');
  // $varname
  let varFlag = false;
  const regResult1 = varname.match(/^\${?(\w+)}?/);
  if (!!regResult1) {
    varFlag = true;
    varname = `\$\{${regResult1[1]}\:json\}`;
  }
  // [[varname]]
  const regResult2 = varname.match(/^\[\[(\w+)(\:\w+)?\]\]/);
  if (!!regResult2) {
    varFlag = true;
    varname = `\$\{${regResult2[1]}\:json\}`;
  }
  return { varname, varFlag };
}

export function ReplaceVariable(templateSrv, scopedVars, field, multiple = false) {
  const { varname, varFlag } = parseVariableFormat(field);
  let replaceVar = templateSrv.replace(varname, scopedVars);
  if (varFlag) {
    replaceVar = JSON.parse(replaceVar);
  }
  if (!multiple && _.isArray(replaceVar)) {
    replaceVar = _.get(replaceVar, '0', '');
  }
  return replaceVar;
}

// get dimensions for instance query param
export function GetDimensions(obj) {
  if (_.isEmpty(obj)) {
    return [];
  }
  const dimensions: any[] = [];
  _.forEach(obj, item => {
    if (item.Value) {
      dimensions.push({ Name: item.Name, Value: typeof item.Value === 'string' ? item.Value : `${item.Value}` });
    }
  });
  return dimensions;
}

// parse query data result for panel
export function ParseQueryResult(response, instances) {
  const dataPoints = _.get(response, 'DataPoints', []);
  return _.map(dataPoints, dataPoint => {
    let instanceAliasValue = _.get(dataPoint, 'Dimensions[0].Value');
    for (let i = 0; i < instances.length; i++) {
      if (isInstanceMatch(instances[i], _.get(dataPoint, 'Dimensions', []))) {
        instanceAliasValue = instances[i]._InstanceAliasValue;
        instances.splice(i, 1);
        break;
      }
    }
    return {
      target: `${response.MetricName} - ${instanceAliasValue}`,
      datapoints: parseDataPoint(dataPoint),
    };
  });
}

// parse tencent cloud monitor response data to grafana panel data
function parseDataPoint(dataPoint) {
  const timestamps = _.get(dataPoint, 'Timestamps', []);
  const values = _.get(dataPoint, 'Values', []);
  const result = timestamps.map((timestamp, index) => {
    return [values[index], timestamp * 1000];
  });

  return result;
}

// check whether instance is match or not
function isInstanceMatch(instance, dimensions) {
  let match = true;
  for (let i = 0; i < dimensions.length; i++) {
    if (_.get(instance, dimensions[i].Name).toString() !== dimensions[i].Value.toString()) {
      match = false;
      break;
    }
  }
  return match;
}

/**
 * 
 * @param options 接口请求对象 { url: string, data?: object }
 * @param service 产品名字 'cvm'
 * @param signObj 接口请求相关信息 { region?: string, action: string }
 * @param secretId 
 * @param secretKey 
 */
export function GetRequestParams(options, service, signObj: any = {}, secretId, secretKey) {
  const signParams = {
    secretId,
    secretKey,
    payload: options.data || '',
    ...signObj,
    ...(_.pick(GetServiceAPIInfo(signObj.region || '', service), ['service', 'host', 'version']) || {}),
  };
  const sign = new Sign(signParams);
  options.headers = Object.assign(options.headers || {}, { ...sign.getHeader() });
  options.method = 'POST';
  return options;
}
