/** 工单模块前端专用类型 */

/** 车牌片段联想的候选行（对应服务端 suggestVehiclesByPlate 的返回结构） */
export interface VehiclePlateSuggestion {
  id: string;
  plateNumber: string;
  brand: string | null;
  model: string | null;
  /** 只透出 VIN 后 4 位 */
  vinLast4: string | null;
  customerName: string;
  /** 最近一次进厂（ISO 字符串）；从未进厂为 null */
  lastVisitAt: string | null;
  workOrderCount: number;
}

export interface VehicleLookupResult {
  id: string;
  plateNumber: string;
  brand: string | null;
  model: string | null;
  year: number | null;
  vin: string | null;
  currentMileage: number | null;
  customerId: string;
  customerName: string;
  customerPhone: string;
  lastServiceAt: string | null;
  nextServiceAt: string | null;
  engineNo: string | null;
  remark: string | null;
  recentOrders: Array<{
    id: string;
    orderNo: string;
    createdAt: string;
    mileage: number | null;
    totalAmount: string;
  }>;
}
