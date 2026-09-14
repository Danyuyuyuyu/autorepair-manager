/** 工单模块前端专用类型 */

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
