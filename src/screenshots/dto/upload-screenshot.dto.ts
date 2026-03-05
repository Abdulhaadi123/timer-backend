import { IsString, IsNumber, IsDateString } from 'class-validator';

export class UploadScreenshotDto {
  @IsString()
  fileUrl: string;

  @IsDateString()
  capturedAt: string;

  @IsNumber()
  fileSize: number;
}
